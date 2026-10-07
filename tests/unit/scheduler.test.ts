import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectPlatform,
  initialSlots,
  maximumSlots,
  memoryBudget,
} from '../../src/engine/scheduler/budget';
import { calibrate, startCalibration } from '../../src/engine/scheduler/calibrate';
import type { WorkerPool } from '../../src/engine/scheduler/pool';
import { ProgressHub } from '../../src/engine/scheduler/progress.svelte';
import { Scheduler } from '../../src/engine/scheduler/scheduler.svelte';

type Api = { attach(port: MessagePort): void };

function fakePool() {
  const pool = {
    discarded: 0,
    canAcquire: () => true,
    acquire: () => ({ worker: {}, api: {}, jobs: 0, crashed: new Promise<never>(() => {}) }),
    release: () => {},
    discard: () => {
      pool.discarded += 1;
    },
  };
  return pool as typeof pool & WorkerPool<Api>;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => (resolve = res));
  return { promise, resolve };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function memoryError(): Error {
  return Object.assign(new Error('Array buffer allocation failed'), { name: 'RangeError' });
}

describe('Scheduler', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 0));
  });
  afterEach(() => vi.unstubAllGlobals());

  function scheduler(options: { slots?: number; memory?: number } = {}) {
    return new Scheduler({
      hub: new ProgressHub(),
      initialSlots: options.slots ?? 2,
      maximumSlots: options.slots ?? 2,
      memoryBudget: options.memory ?? 1000,
    });
  }

  it('runs no more slots at once than the limit, and backfills smaller jobs', async () => {
    const s = scheduler({ slots: 3 });
    const pool = fakePool();
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const run = (i: number) => () => {
      started.push(i);
      return gates[i]!.promise;
    };
    s.submit({ pool, run: run(0), slots: 2, memory: 1 });
    s.submit({ pool, run: run(1), slots: 2, memory: 1 });
    s.submit({ pool, run: run(2), slots: 1, memory: 1 });
    await flush();
    expect(started).toEqual([0, 2]);
    gates[0]!.resolve();
    await flush();
    expect(started).toEqual([0, 2, 1]);
  });

  it('holds jobs back when memory is spent, but never starves a lone big job', async () => {
    const s = scheduler({ slots: 4, memory: 100 });
    const pool = fakePool();
    const gate = deferred();
    const started: string[] = [];
    s.submit({ pool, memory: 500, run: () => (started.push('big'), gate.promise) });
    s.submit({ pool, memory: 10, run: () => (started.push('small'), Promise.resolve()) });
    await flush();
    expect(started).toEqual(['big']);
    gate.resolve();
    await flush();
    expect(started).toEqual(['big', 'small']);
  });

  it('reruns a job alone after a memory failure, then gives up', async () => {
    const s = scheduler();
    let attempts = 0;
    const task = s.submit({
      pool: fakePool(),
      run: () => (attempts++, Promise.reject(memoryError())),
    });
    await expect(task.result).rejects.toThrow('allocation failed');
    expect(attempts).toBe(2);
  });

  it('starts nothing else while a job reruns alone', async () => {
    const s = scheduler({ slots: 4 });
    const pool = fakePool();
    const gate = deferred();
    const started: string[] = [];
    let attempts = 0;
    s.submit({
      pool,
      run: () => {
        attempts += 1;
        started.push(`heavy-${attempts}`);
        return attempts === 1 ? Promise.reject(memoryError()) : gate.promise;
      },
    });
    await flush();
    s.submit({ pool, run: () => (started.push('light'), Promise.resolve()) });
    await flush();
    expect(started).toEqual(['heavy-1', 'heavy-2']);
    gate.resolve();
    await flush();
    expect(started).toEqual(['heavy-1', 'heavy-2', 'light']);
  });

  it('does not retry ordinary errors', async () => {
    const s = scheduler();
    let attempts = 0;
    const task = s.submit({
      pool: fakePool(),
      run: () => (attempts++, Promise.reject(new Error('bad input'))),
    });
    await expect(task.result).rejects.toThrow('bad input');
    expect(attempts).toBe(1);
  });

  it('cancels pending and running jobs', async () => {
    const s = scheduler({ slots: 1 });
    const pool = fakePool();
    const running = s.submit({ pool, run: () => new Promise(() => {}) });
    const waiting = s.submit({ pool, run: () => Promise.resolve() });
    await flush();
    waiting.cancel();
    running.cancel();
    await expect(waiting.result).rejects.toMatchObject({ name: 'AbortError' });
    await expect(running.result).rejects.toMatchObject({ name: 'AbortError' });
    expect(pool.discarded).toBe(1);
  });
});

describe('calibrate', () => {
  it('climbs while throughput improves and settles on the best limit', () => {
    let state = startCalibration(4, 16);
    state = calibrate(state, 100);
    expect(state.limit).toBe(5);
    state = calibrate(state, 120);
    expect(state.limit).toBe(6);
    state = calibrate(state, 121);
    expect(state).toMatchObject({ limit: 5, settled: true });
  });

  it('stops at the maximum', () => {
    let state = startCalibration(2, 2);
    state = calibrate(state, 100);
    expect(state).toMatchObject({ limit: 2, settled: true });
  });
});

describe('budget', () => {
  it('detects platforms, including iPads that report as Macs', () => {
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe(
      'desktop',
    );
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' })).toBe(
      'mobile',
    );
    expect(
      detectPlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }),
    ).toBe('ios');
    const iPad = {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      maxTouchPoints: 5,
    };
    expect(detectPlatform(iPad)).toBe('ios');
  });

  it('leaves a core for the interface by default', () => {
    expect(initialSlots(8, 'balanced')).toBe(7);
    expect(initialSlots(8, 'gentle')).toBe(4);
    expect(initialSlots(8, 'maximum')).toBe(8);
    expect(initialSlots(1, 'balanced')).toBe(1);
  });

  it('trusts a plausible core count as the ceiling, but probes past a suspiciously small one', () => {
    expect(maximumSlots(8, 'balanced')).toBe(8);
    expect(maximumSlots(8, 'gentle')).toBe(4);
    expect(maximumSlots(2, 'balanced')).toBe(4);
  });

  it('lowers the memory budget on small devices', () => {
    expect(memoryBudget('desktop', 2)).toBe(1024 * 1024 * 1024);
    expect(memoryBudget('ios')).toBe(300 * 1024 * 1024);
  });
});
