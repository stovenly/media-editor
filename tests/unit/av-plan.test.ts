import { describe, expect, it } from 'vitest';
import {
  estimateBytes,
  ffmpegArgs,
  outputSize,
  planBitrates,
  routeAv,
  type AvSettings,
} from '../../src/engine/av/plan';
import type { AvProbe } from '../../src/media/probe';

const VIDEO: AvProbe = {
  native: true,
  container: 'MP4',
  duration: 60,
  video: {
    codec: 'avc',
    width: 1920,
    height: 1080,
    fps: 30,
    bitrate: 8_000_000,
    decodable: true,
    alpha: false,
  },
  audio: { codec: 'aac', sampleRate: 48000, channels: 2, bitrate: 128_000, decodable: true },
  subtitles: [],
  tags: { location: false, title: null, hasCover: false },
};

const settings = (overrides: Partial<AvSettings> = {}): AvSettings => ({
  target: 'mp4',
  quality: 82,
  height: null,
  fps: null,
  removeAudio: false,
  audioKbps: null,
  sampleRate: null,
  channels: null,
  videoCodec: null,
  targetBytes: null,
  metadata: 'none',
  trimStart: null,
  trimEnd: null,
  gif: { fps: 15, width: 480, dither: 'floyd', palette: 'global' },
  allowCopy: true,
  ...overrides,
});

describe('routeAv', () => {
  it('prefers the native engine for containers and codecs it handles', () => {
    expect(routeAv(VIDEO, settings())).toBe('native');
    expect(routeAv(VIDEO, settings({ target: 'mp3' }))).toBe('native');
  });

  it('uses FFmpeg for outputs or inputs the native engine cannot handle', () => {
    expect(routeAv(VIDEO, settings({ target: 'avi' }))).toBe('ffmpeg');
    expect(routeAv(VIDEO, settings({ target: 'gif-anim' }))).toBe('ffmpeg');
    expect(routeAv({ ...VIDEO, native: false }, settings())).toBe('ffmpeg');
    expect(routeAv({ ...VIDEO, video: { ...VIDEO.video!, decodable: false } }, settings())).toBe(
      'ffmpeg',
    );
    expect(routeAv(undefined, settings())).toBe('ffmpeg');
  });

  it('ignores an undecodable audio track that is being removed', () => {
    const probe = { ...VIDEO, audio: { ...VIDEO.audio!, decodable: false } };
    expect(routeAv(probe, settings())).toBe('ffmpeg');
    expect(routeAv(probe, settings({ removeAudio: true }))).toBe('native');
  });
});

describe('sizes and bitrates', () => {
  it('scales to a height, keeping even dimensions and never enlarging', () => {
    expect(outputSize({ width: 1920, height: 1080 }, 720)).toEqual({ width: 1280, height: 720 });
    expect(outputSize({ width: 1920, height: 1080 }, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(outputSize({ width: 641, height: 361 }, 240)).toEqual({ width: 426, height: 240 });
  });

  it('fits a target size, stepping resolution down when bits per pixel would be too low', () => {
    const plan = planBitrates(VIDEO, settings({ targetBytes: 10_000_000 }));
    const total = ((plan.video! + plan.audio!) * VIDEO.duration) / 8;
    expect(total).toBeLessThanOrEqual(10_000_000);
    expect(plan.size!.height).toBeLessThan(1080);
    expect(plan.notes.join()).toMatch(/Reduced to \d+p to fit/);
  });

  it('gives audio-only outputs the whole budget', () => {
    const plan = planBitrates(VIDEO, settings({ target: 'mp3', targetBytes: 600_000 }));
    expect(plan.video).toBeNull();
    expect((plan.audio! * 60) / 8).toBeLessThanOrEqual(600_000);
  });

  it('estimates lossless audio from the sample rate', () => {
    expect(estimateBytes(VIDEO, settings({ target: 'wav' }))).toBe(48000 * 2 * 2 * 60);
  });

  it('accounts for trims and the ringtone limit', () => {
    const full = estimateBytes(VIDEO, settings({ target: 'm4a' }))!;
    const trimmed = estimateBytes(VIDEO, settings({ target: 'm4a', trimStart: 10, trimEnd: 40 }))!;
    const ringtone = estimateBytes(VIDEO, settings({ target: 'm4r' }))!;
    expect(trimmed / full).toBeCloseTo(0.5, 1);
    expect(ringtone / full).toBeCloseTo(40 / 60, 1);
  });
});

describe('ffmpegArgs', () => {
  it('strips metadata and data streams by default', () => {
    const { args } = ffmpegArgs('in.avi', VIDEO, settings({ target: 'avi' }));
    expect(args).toEqual(expect.arrayContaining(['-map_metadata', '-1', '-dn', '+bitexact']));
  });

  it('keeps metadata when asked', () => {
    const { args } = ffmpegArgs('in.avi', VIDEO, settings({ target: 'avi', metadata: 'all' }));
    expect(args).not.toContain('-map_metadata');
  });

  it('builds a palette pipeline for GIFs', () => {
    const { args, output } = ffmpegArgs('in.mp4', VIDEO, settings({ target: 'gif-anim' }));
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('palettegen');
    expect(graph).toContain('paletteuse=dither=floyd_steinberg');
    expect(output.endsWith('.gif')).toBe(true);
  });

  it('decodes VP9 with libvpx to keep transparency', () => {
    const alpha = { ...VIDEO, video: { ...VIDEO.video!, codec: 'vp9', alpha: true } };
    const { args } = ffmpegArgs('in.webm', alpha, settings({ target: 'webm' }));
    expect(args.indexOf('libvpx-vp9')).toBeLessThan(args.indexOf('-i'));
    expect(args).toContain('yuva420p');
  });

  it('trims with seek before the input and a duration', () => {
    const { args } = ffmpegArgs(
      'in.mp4',
      VIDEO,
      settings({ target: 'avi', trimStart: 5, trimEnd: 15 }),
    );
    expect(args.slice(0, args.indexOf('-i'))).toEqual(expect.arrayContaining(['-ss', '5']));
    expect(args[args.indexOf('-t') + 1]).toBe('10');
  });

  it('uses a bitrate cap instead of CRF when fitting a size', () => {
    const { args } = ffmpegArgs(
      'in.mp4',
      VIDEO,
      settings({ target: 'mkv', targetBytes: 10_000_000 }),
    );
    expect(args).toContain('-maxrate');
    expect(args).not.toContain('-crf');
  });
});
