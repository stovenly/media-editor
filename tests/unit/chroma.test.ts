import { describe, expect, it } from 'vitest';
import { applyChromaKey } from '../../src/engine/video/chroma';
import { DEFAULT_KEY } from '../../src/project/video';

const pixel = (r: number, g: number, b: number, key = DEFAULT_KEY) => {
  const data = new Uint8ClampedArray([r, g, b, 255]);
  applyChromaKey(data, key);
  return [...data];
};

describe('chroma key', () => {
  it('clears the key colour, including darker and lighter shades of it', () => {
    expect(pixel(0, 255, 0)[3]).toBe(0);
    expect(pixel(20, 140, 30)[3]).toBe(0);
    expect(pixel(120, 255, 120)[3]).toBe(0);
  });

  it('keeps colours far from the key', () => {
    expect(pixel(220, 40, 40)).toEqual([220, 40, 40, 255]);
    expect(pixel(240, 240, 240)[3]).toBe(255);
    expect(pixel(10, 10, 10)[3]).toBe(255);
  });

  it('softens the edge between keyed and kept', () => {
    const edge = { ...DEFAULT_KEY, similarity: 0.6, smoothness: 0.6 };
    const alpha = pixel(110, 180, 100, edge)[3]!;
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(255);
  });

  it('pulls green spill out of what is kept', () => {
    const [r, g, b, a] = pixel(200, 190, 140, { ...DEFAULT_KEY, spill: 1 });
    expect(a).toBe(255);
    expect(g).toBeLessThan(190);
    expect(r).toBeGreaterThan(g!);
    expect(b).toBeGreaterThan(0);
  });

  it('keys any colour, such as blue', () => {
    const blue = { ...DEFAULT_KEY, color: '#0047bb' };
    expect(pixel(0, 71, 187, blue)[3]).toBe(0);
    expect(pixel(0, 255, 0, blue)[3]).toBe(255);
  });
});
