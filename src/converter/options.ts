import type { MetadataMode } from '../engine/image/settings';

export type ConvertOptions = {
  quality: number; // 1..100, higher is better
  maxEdge: number | null; // images: longest edge in pixels
  height: number | null; // video: output height in pixels
  targetMb: number | null; // decimal megabytes
  background: string; // #rrggbb
  metadata: MetadataMode;
  removeAudio: boolean;
  keepHdr: boolean;
  lossless: boolean;
  gifThreshold: number; // 0..255
  hotspotX: number; // pixels on the 32 px cursor
  hotspotY: number;
  maskableBackground: string;
  fps: number | null;
  audioKbps: number | null;
  sampleRate: number | null; // Hz
  channels: number | null;
  videoCodec: string | null;
  gifFps: number;
  gifWidth: number;
  gifDither: 'none' | 'bayer' | 'floyd';
  gifPalette: 'global' | 'per-frame' | 'diff' | 'gifski';
  trimStart: number | null; // seconds
  trimEnd: number | null;
};

export const DEFAULT_OPTIONS: ConvertOptions = {
  quality: 82,
  maxEdge: null,
  height: null,
  targetMb: null,
  background: '#ffffff',
  metadata: 'none',
  removeAudio: false,
  keepHdr: true,
  lossless: false,
  gifThreshold: 128,
  hotspotX: 0,
  hotspotY: 0,
  maskableBackground: '#ffffff',
  fps: null,
  audioKbps: null,
  sampleRate: null,
  channels: null,
  videoCodec: null,
  gifFps: 15,
  gifWidth: 480,
  gifDither: 'floyd',
  gifPalette: 'global',
  trimStart: null,
  trimEnd: null,
};

export function optionsKey(target: string, options: ConvertOptions, edit: unknown = null): string {
  return JSON.stringify([target, options, edit]);
}
