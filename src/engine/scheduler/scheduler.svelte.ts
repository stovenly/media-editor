import type * as Comlink from 'comlink';
import { calibrate, startCalibration, underPressure, type Calibration } from './calibrate';
import { WorkerCrashError, type Member, type PoolWorkerApi, type WorkerPool } from './pool';
import type { ProgressHub } from './progress.svelte';

export type TaskSpec<Api extends PoolWorkerApi, Result> = {
  pool: WorkerPool<Api>;
  run: (api: Comlink.Remote<Api>, jobId: string) => Promise<Result>;
  slots?: number;
  memory?: number; // bytes
  units?: number; // work done, for throughput; input bytes is a good choice
};

export type Task<Result> = {
  id: string;
  result: Promise<Result>;
  cancel(): void;
};

type Entry = {
  id: string;
  spec: TaskSpec<PoolWorkerApi, unknown>;
  slots: number;
  memory: number;
  exclusive: boolean;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  member?: Member<PoolWorkerApi>;
  lastActivity: number;
};

export type SchedulerOptions = {
  hub: ProgressHub;
  initialSlots: number;
  maximumSlots: number;
  memoryBudget: number;
  stallMs?: number;
  windowMs?: number;
};

const DEFAULT_MEMORY = 64 * 1024 * 1024;

export class Scheduler {
  stalled = $state.raw<ReadonlySet<string>>(new Set());

  private pending: Entry[] = [];
  private running = new Map<string, Entry>();
  private calibration: Calibration;
  private nextId = 0;
  // Only jobs that declare units of work count towards calibration; tiny bookkeeping jobs would skew it.
  private window = { start: 0, saturated: true, units: 0, measured: true };
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: SchedulerOptions) {
    this.calibration = startCalibration(options.initialSlots, options.maximumSlots);
    options.hub.onReport((jobId) => this.touch(jobId));
    this.observePressure();
  }

  get limit(): number {
    return this.calibration.limit;
  }

  configure(initialSlots: number, maximumSlots: number): void {
    this.calibration = startCalibration(initialSlots, maximumSlots);
    this.pump();
  }

  submit<Api extends PoolWorkerApi, Result>(spec: TaskSpec<Api, Result>): Task<Result> {
    const id = `job-${++this.nextId}`;
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const result = new Promise<Result>((res, rej) => {
      resolve = res as (value: unknown) => void;
      reject = rej;
    });
    this.pending.push({
      id,
      spec: spec as unknown as TaskSpec<PoolWorkerApi, unknown>,
      slots: Math.max(1, spec.slots ?? 1),
      memory: spec.memory ?? DEFAULT_MEMORY,
      exclusive: false,
      resolve,
      reject,
      lastActivity: 0,
    });
    this.pump();
    return { id, result, cancel: () => this.cancel(id) };
  }

  cancel(id: string): void {
    const index = this.pending.findIndex((entry) => entry.id === id);
    if (index >= 0) {
      this.pending.splice(index, 1)[0]!.reject(new DOMException('Cancelled', 'AbortError'));
      return;
    }
    const entry = this.running.get(id);
    if (!entry) return;
    if (entry.member) entry.spec.pool.discard(entry.member);
    this.finish(entry);
    entry.reject(new DOMException('Cancelled', 'AbortError'));
  }

  // A job that failed for lack of memory reruns exclusive: alone, and with
  // nothing else started until it finishes.
  private pump(): void {
    const exclusiveRunning = [...this.running.values()].some((entry) => entry.exclusive);
    for (let i = 0; i < this.pending.length && !exclusiveRunning;) {
      const entry = this.pending[i]!;
      if (entry.exclusive) {
        if (this.running.size === 0 && entry.spec.pool.canAcquire()) this.start(i);
        break;
      }
      if (this.fits(entry)) this.start(i);
      else i++;
    }
    if (this.pending.length === 0) this.window.saturated = false;
    this.tick();
  }

  private fits(entry: Entry): boolean {
    if (!entry.spec.pool.canAcquire()) return false;
    if (this.running.size === 0) return true;
    const slotsFree = this.usedSlots() + entry.slots <= this.limit;
    const memoryFree = this.usedMemory() + entry.memory <= this.options.memoryBudget;
    return slotsFree && memoryFree;
  }

  private start(index: number): void {
    const [entry] = this.pending.splice(index, 1);
    if (!entry) return;
    const member = entry.spec.pool.acquire();
    entry.member = member;
    entry.lastActivity = performance.now();
    this.running.set(entry.id, entry);
    Promise.race([entry.spec.run(member.api, entry.id), member.crashed]).then(
      (value) => {
        if (!this.running.has(entry.id)) return;
        entry.spec.pool.release(member);
        if (entry.spec.units === undefined) this.window.measured = false;
        else this.window.units += entry.spec.units;
        this.finish(entry);
        entry.resolve(value);
      },
      (error: unknown) => {
        if (!this.running.has(entry.id)) return;
        entry.spec.pool.discard(member);
        this.finish(entry);
        if (isMemoryFailure(error) && !entry.exclusive) {
          this.pending.unshift({ ...entry, exclusive: true, member: undefined });
          this.pump();
        } else {
          entry.reject(error);
        }
      },
    );
  }

  private finish(entry: Entry): void {
    this.running.delete(entry.id);
    this.options.hub.forget(entry.id);
    if (this.stalled.has(entry.id)) {
      const next = new Set(this.stalled);
      next.delete(entry.id);
      this.stalled = next;
    }
    queueMicrotask(() => this.pump());
  }

  private touch(jobId: string): void {
    const entry = this.running.get(jobId);
    if (!entry) return;
    entry.lastActivity = performance.now();
    if (this.stalled.has(jobId)) {
      const next = new Set(this.stalled);
      next.delete(jobId);
      this.stalled = next;
    }
  }

  private tick(): void {
    if (this.running.size === 0 && this.pending.length === 0) {
      clearInterval(this.timer);
      this.timer = undefined;
      return;
    }
    if (this.timer) return;
    this.window = { start: performance.now(), saturated: true, units: 0, measured: true };
    this.timer = setInterval(() => this.check(), 1000);
  }

  private check(): void {
    const now = performance.now();
    const stallMs = this.options.stallMs ?? 30_000;
    const stalled = [...this.running.values()]
      .filter((entry) => now - entry.lastActivity > stallMs)
      .map((entry) => entry.id);
    if (stalled.length !== this.stalled.size || stalled.some((id) => !this.stalled.has(id))) {
      this.stalled = new Set(stalled);
    }

    const elapsed = now - this.window.start;
    if (elapsed >= (this.options.windowMs ?? 5000)) {
      if (this.window.saturated && this.window.measured && this.window.units > 0) {
        this.calibration = calibrate(this.calibration, this.window.units / (elapsed / 1000));
      }
      this.window = { start: now, saturated: true, units: 0, measured: true };
      this.pump();
    }
    this.tick();
  }

  private usedSlots(): number {
    let total = 0;
    for (const entry of this.running.values()) total += entry.slots;
    return total;
  }

  private usedMemory(): number {
    let total = 0;
    for (const entry of this.running.values()) total += entry.memory;
    return total;
  }

  private observePressure(): void {
    const Observer = (globalThis as { PressureObserver?: PressureObserverConstructor })
      .PressureObserver;
    if (!Observer) return;
    try {
      const observer = new Observer((records) => {
        const state = records.at(-1)?.state;
        if (!state) return;
        this.calibration = underPressure(this.calibration, state);
        this.pump();
      });
      void observer.observe('cpu').catch(() => {});
    } catch {
      // Not permitted in this context.
    }
  }
}

type PressureState = 'nominal' | 'fair' | 'serious' | 'critical';
type PressureObserverConstructor = new (
  callback: (records: { state: PressureState }[]) => void,
) => { observe(source: 'cpu'): Promise<void> };

export function isMemoryFailure(error: unknown): boolean {
  if (error instanceof WorkerCrashError) return true;
  if (!(error instanceof Error)) return false;
  if (error.name === 'RangeError') return true;
  return /out of memory|memory access out of bounds|allocation failed|Cannot enlarge memory|Aborted\(OOM\)|Maximum memory size/i.test(
    error.message,
  );
}
