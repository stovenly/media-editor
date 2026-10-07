import * as Comlink from 'comlink';
import type { ProgressHub } from './progress.svelte';

// Every pool worker exposes `attach`, which receives its progress port.
export type PoolWorkerApi = { attach(port: MessagePort): void };

export type Member<Api> = {
  worker: Worker;
  api: Comlink.Remote<Api>;
  jobs: number;
  crashed: Promise<never>;
  idleTimer?: ReturnType<typeof setTimeout>;
};

export type PoolOptions = {
  create: () => Worker;
  hub: ProgressHub;
  // WASM heaps only grow, so a worker is replaced after this many jobs.
  recycleAfter?: number;
  // All workers share one renderer process, and each engine instance reserves its own heap.
  maxWorkers?: number;
  idleMs?: number;
};

const DEFAULT_IDLE_MS = 30_000;

export class WorkerPool<Api extends PoolWorkerApi> {
  private idle: Member<Api>[] = [];
  private live = 0;

  constructor(private readonly options: PoolOptions) {}

  get maxWorkers(): number {
    return this.options.maxWorkers ?? Infinity;
  }

  canAcquire(): boolean {
    return this.idle.length > 0 || this.live < this.maxWorkers;
  }

  acquire(): Member<Api> {
    const member = this.idle.pop();
    if (member) {
      clearTimeout(member.idleTimer);
      return member;
    }
    return this.spawn();
  }

  release(member: Member<Api>): void {
    member.jobs += 1;
    if (member.jobs >= (this.options.recycleAfter ?? 50)) {
      this.terminate(member);
      return;
    }
    member.idleTimer = setTimeout(() => {
      this.idle = this.idle.filter((m) => m !== member);
      this.terminate(member);
    }, this.options.idleMs ?? DEFAULT_IDLE_MS);
    this.idle.push(member);
  }

  discard(member: Member<Api>): void {
    this.terminate(member);
  }

  terminateIdle(): void {
    for (const member of this.idle) {
      clearTimeout(member.idleTimer);
      this.terminate(member);
    }
    this.idle = [];
  }

  private terminate(member: Member<Api>): void {
    member.worker.terminate();
    this.live -= 1;
  }

  private spawn(): Member<Api> {
    const worker = this.options.create();
    this.live += 1;
    const crashed = new Promise<never>((_, reject) => {
      worker.addEventListener('error', (event) => {
        event.preventDefault();
        reject(new WorkerCrashError(event.message || 'The worker stopped unexpectedly'));
      });
    });
    crashed.catch(() => {});
    const api = Comlink.wrap<Api>(worker);
    const channel = new MessageChannel();
    this.options.hub.listen(channel.port1);
    void api.attach(Comlink.transfer(channel.port2, [channel.port2]));
    return { worker, api, jobs: 0, crashed };
  }
}

export class WorkerCrashError extends Error {
  override name = 'WorkerCrashError';
}
