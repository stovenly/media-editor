import { describe, expect, it } from 'vitest';
import {
  applyChannelOp,
  fadeCurve,
  LoudnessMeter,
  remapChannels,
  Resampler,
  TimeStretch,
  type Planar,
} from '../../src/engine/audio/dsp';

function sine(
  rate: number,
  seconds: number,
  freq: number,
  amplitude: number,
  channels = 2,
): Planar {
  const frames = Math.round(rate * seconds);
  const plane = new Float32Array(frames);
  for (let i = 0; i < frames; i++) plane[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / rate);
  return Array.from({ length: channels }, () => plane.slice());
}

function zeroCrossings(plane: Float32Array): number {
  let count = 0;
  for (let i = 1; i < plane.length; i++) if (plane[i - 1]! < 0 !== plane[i]! < 0) count++;
  return count;
}

describe('audio DSP', () => {
  it('resamples in blocks without changing pitch', () => {
    const input = sine(44100, 1, 440, 0.5, 1);
    const resampler = new Resampler(44100, 48000, 1);
    const parts = [0, 1, 2, 3].map((i) =>
      resampler.process([input[0]!.subarray(i * 11025, (i + 1) * 11025)]),
    );
    const out = new Float32Array(parts.reduce((n, p) => n + p[0]!.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p[0]!, at);
      at += p[0]!.length;
    }
    expect(Math.abs(out.length - 48000)).toBeLessThan(8);
    expect(Math.abs(zeroCrossings(out) - 880)).toBeLessThan(4);
  });

  it('measures EBU R128 loudness of a reference tone', () => {
    const meter = new LoudnessMeter(48000, 2);
    const tone = sine(48000, 5, 1000, 10 ** (-23 / 20));
    for (let i = 0; i < 5; i++) meter.add(tone.map((p) => p.subarray(i * 48000, (i + 1) * 48000)));
    expect(meter.integrated).toBeCloseTo(-23, 0);
    expect(meter.peak).toBeCloseTo(10 ** (-23 / 20), 3);
  });

  it('reports silence as negative infinity', () => {
    const meter = new LoudnessMeter(48000, 1);
    meter.add([new Float32Array(48000)]);
    expect(meter.integrated).toBe(-Infinity);
  });

  it('time-stretches while keeping pitch', () => {
    for (const speed of [2, 0.5]) {
      const stretch = new TimeStretch(48000, 1, speed);
      const input = sine(48000, 2, 440, 0.5, 1)[0]!;
      const a = stretch.process([input.subarray(0, 48000)]);
      const b = stretch.process([input.subarray(48000)], true);
      const out = new Float32Array(a[0]!.length + b[0]!.length);
      out.set(a[0]!);
      out.set(b[0]!, a[0]!.length);
      const seconds = out.length / 48000;
      expect(seconds).toBeGreaterThan((2 / speed) * 0.85);
      expect(seconds).toBeLessThan((2 / speed) * 1.1);
      const hz = zeroCrossings(out) / 2 / seconds;
      expect(Math.abs(hz - 440)).toBeLessThan(25);
    }
  });

  it('maps channels and applies channel operations', () => {
    const left = Float32Array.of(1, 1);
    const right = Float32Array.of(0, 0);
    expect([...remapChannels([left, right], 1)[0]!]).toEqual([0.5, 0.5]);
    expect(remapChannels([left], 2)).toHaveLength(2);
    expect([...applyChannelOp([left, right], 'swap')[0]!]).toEqual([0, 0]);
    expect([...applyChannelOp([left, right], 'mono')[1]!]).toEqual([0.5, 0.5]);
  });

  it('fades with constant power', () => {
    expect(fadeCurve(0)).toBe(0);
    expect(fadeCurve(1)).toBe(1);
    expect(fadeCurve(0.5) ** 2 + fadeCurve(0.5) ** 2).toBeCloseTo(1, 5);
  });
});
