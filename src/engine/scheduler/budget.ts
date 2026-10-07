export type Platform = 'desktop' | 'mobile' | 'ios';
export type Speed = 'balanced' | 'gentle' | 'maximum';

const MB = 1024 * 1024;

// Total working set the scheduler lets running jobs reserve. iOS kills the tab
// without an error past roughly 300 MB of WASM memory.
const MEMORY_BUDGET: Record<Platform, number> = {
  desktop: 3072 * MB,
  mobile: 600 * MB,
  ios: 300 * MB,
};

type NavigatorLike = {
  userAgent: string;
  maxTouchPoints?: number;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  userAgentData?: { mobile?: boolean };
};

export function detectPlatform(nav: NavigatorLike): Platform {
  const ua = nav.userAgent;
  const iPadAsMac = /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadAsMac) return 'ios';
  if (nav.userAgentData?.mobile || /Android|Mobi/.test(ua)) return 'mobile';
  return 'desktop';
}

export function memoryBudget(platform: Platform, deviceMemoryGb?: number): number {
  const base = MEMORY_BUDGET[platform];
  if (!deviceMemoryGb) return base;
  return Math.min(base, (deviceMemoryGb * 1024 * MB) / 2);
}

// The browser's core count is a starting point only: Safari caps it at 8 and
// fingerprinting protection reports small or random values. Calibration corrects it.
export function initialSlots(hardwareConcurrency: number | undefined, speed: Speed): number {
  const cores = Math.max(1, hardwareConcurrency || 4);
  if (speed === 'maximum') return cores;
  if (speed === 'gentle') return Math.max(1, Math.floor(cores / 2));
  return Math.max(1, cores - 1);
}

// A plausible core count is trusted as the ceiling; a small one may be spoofed, so calibration may probe past it.
export function maximumSlots(hardwareConcurrency: number | undefined, speed: Speed): number {
  const initial = initialSlots(hardwareConcurrency, speed);
  if (speed === 'gentle') return initial;
  const cores = Math.max(1, hardwareConcurrency || 4);
  return cores >= 4 ? cores : Math.min(8, Math.max(2, cores * 2));
}

const GB = 1_000_000_000;

// Outputs are built in memory; above these sizes the browser may run out.
export function outputWarnLimit(platform: Platform, engine: 'native' | 'ffmpeg'): number {
  if (platform === 'ios') return 150_000_000;
  if (platform === 'mobile') return 300_000_000;
  return engine === 'ffmpeg' ? 1 * GB : 2 * GB;
}
