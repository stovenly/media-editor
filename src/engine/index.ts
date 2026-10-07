import type { AvApi } from '../workers/av.worker';
import type { ImageApi } from '../workers/image.worker';
import type { InspectApi } from '../workers/inspect.worker';
import type { ZipApi } from '../workers/zip.worker';
import {
  detectPlatform,
  initialSlots,
  maximumSlots,
  memoryBudget,
  type Speed,
} from './scheduler/budget';
import { WorkerPool } from './scheduler/pool';
import { ProgressHub } from './scheduler/progress.svelte';
import { Scheduler } from './scheduler/scheduler.svelte';

type NavigatorWithHints = Navigator & {
  deviceMemory?: number;
  userAgentData?: { mobile?: boolean };
};

const SPEED_KEY = 'speed';

export function storedSpeed(): Speed {
  const value = localStorage.getItem(SPEED_KEY);
  return value === 'gentle' || value === 'maximum' ? value : 'balanced';
}

export function storeSpeed(speed: Speed): void {
  if (speed === 'balanced') localStorage.removeItem(SPEED_KEY);
  else localStorage.setItem(SPEED_KEY, speed);
  scheduler.configure(initialSlots(navigator.hardwareConcurrency, speed), speedMaximum(speed));
}

function speedMaximum(speed: Speed): number {
  return maximumSlots(navigator.hardwareConcurrency, speed);
}

const nav = navigator as NavigatorWithHints;
const speed = storedSpeed();
export const platform = detectPlatform(nav);

export const hub = new ProgressHub();

const budget = memoryBudget(platform, nav.deviceMemory);

export const scheduler = new Scheduler({
  hub,
  initialSlots: initialSlots(nav.hardwareConcurrency, speed),
  maximumSlots: speedMaximum(speed),
  memoryBudget: budget,
});

const MB = 1024 * 1024;

export const inspectPool = new WorkerPool<InspectApi>({
  create: () =>
    new Worker(new URL('../workers/inspect.worker.ts', import.meta.url), { type: 'module' }),
  hub,
  maxWorkers: 4,
});

export const imagePool = new WorkerPool<ImageApi>({
  create: () =>
    new Worker(new URL('../workers/image.worker.ts', import.meta.url), { type: 'module' }),
  hub,
  recycleAfter: 20,
  maxWorkers: Math.max(1, Math.min(4, Math.floor(budget / (600 * MB)))),
});

export const zipPool = new WorkerPool<ZipApi>({
  create: () =>
    new Worker(new URL('../workers/zip.worker.ts', import.meta.url), { type: 'module' }),
  hub,
});

export const avPool = new WorkerPool<AvApi>({
  create: () => new Worker(new URL('../workers/av.worker.ts', import.meta.url), { type: 'module' }),
  hub,
  recycleAfter: 10,
  maxWorkers: Math.max(1, Math.min(2, Math.floor(budget / (1024 * MB)))),
});
