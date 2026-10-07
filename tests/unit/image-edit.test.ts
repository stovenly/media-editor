import Vips from 'wasm-vips';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyEdit } from '../../src/engine/image/edit';
import type { Vips as VipsInstance } from '../../src/engine/image/engines';
import { Scope } from '../../src/engine/image/vips-util';
import {
  aspectCrop,
  EMPTY_EDIT,
  finalSize,
  inscribedSize,
  isEmptyEdit,
  type ImageEdit,
} from '../../src/project/image-edit';

let vips: VipsInstance;

beforeAll(async () => {
  vips = await Vips({ dynamicLibraries: [] });
  vips.concurrency(1);
}, 60_000);

function grey(width: number, height: number, value = 128) {
  return vips.Image.black(width, height, { bands: 3 })
    .linear(0, value)
    .cast('uchar')
    .copy({ interpretation: 'srgb' });
}

function run(edit: Partial<ImageEdit>, image = grey(100, 50)) {
  const scope = new Scope();
  const out = applyEdit(vips, scope, image, { ...EMPTY_EDIT, ...edit }, 1);
  return { out, scope };
}

describe('edit model', () => {
  it('recognises an untouched edit', () => {
    expect(isEmptyEdit(EMPTY_EDIT)).toBe(true);
    expect(isEmptyEdit({ ...EMPTY_EDIT, flipH: true })).toBe(false);
  });

  it('finds the largest upright rectangle in a rotated image', () => {
    const square = inscribedSize({ width: 100, height: 100 }, 45);
    expect(square.width).toBeCloseTo(70.7, 0);
    expect(inscribedSize({ width: 100, height: 50 }, 0)).toEqual({ width: 100, height: 50 });
  });

  it('centres an aspect-ratio crop', () => {
    expect(aspectCrop({ width: 200, height: 100 }, 1)).toEqual({
      x: 0.25,
      y: 0,
      width: 0.5,
      height: 1,
    });
  });

  it('predicts the final size', () => {
    const edit = {
      ...EMPTY_EDIT,
      rotate: 90 as const,
      crop: { x: 0, y: 0, width: 0.5, height: 1 },
      pad: { top: 1, right: 2, bottom: 3, left: 4, color: '#fff' },
    };
    expect(finalSize({ width: 100, height: 50 }, edit)).toEqual({ width: 25 + 6, height: 100 + 4 });
  });
});

describe('applyEdit', () => {
  it('rotates by quarter turns and flips', () => {
    const { out, scope } = run({ rotate: 90, flipH: true });
    expect([out.width, out.height]).toEqual([50, 100]);
    scope.dispose();
  });

  it('crops a free rotation to the inscribed rectangle', () => {
    const { out, scope } = run({ angle: 10 });
    const inner = inscribedSize({ width: 100, height: 50 }, 10);
    expect(out.width).toBe(Math.floor(inner.width));
    expect(out.height).toBe(Math.floor(inner.height));
    expect(out.getpoint(0, 0)[0]).toBeCloseTo(128, -1);
    scope.dispose();
  });

  it('crops by fractions', () => {
    const { out, scope } = run({ crop: { x: 0.5, y: 0, width: 0.5, height: 0.5 } });
    expect([out.width, out.height]).toEqual([50, 25]);
    scope.dispose();
  });

  it('fills a redaction with a solid colour', () => {
    const { out, scope } = run({
      redactions: [
        { id: 'r', rect: { x: 0, y: 0, width: 0.2, height: 0.2 }, kind: 'fill', color: '#000000' },
      ],
    });
    expect(out.getpoint(2, 2)).toEqual([0, 0, 0]);
    expect(out.getpoint(90, 40)).toEqual([128, 128, 128]);
    scope.dispose();
  });

  it('pixelates and blurs without changing size', () => {
    for (const kind of ['blur', 'pixelate'] as const) {
      const { out, scope } = run({
        redactions: [
          { id: 'r', rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, kind, color: '#000' },
        ],
      });
      expect([out.width, out.height]).toEqual([100, 50]);
      scope.dispose();
    }
  });

  it('brightens with exposure and keeps alpha', () => {
    const rgba = grey(10, 10, 100).bandjoin(200).copy({ interpretation: 'srgb' });
    const { out, scope } = run({ adjust: { ...EMPTY_EDIT.adjust, exposure: 1 } }, rgba);
    const [r, , , a] = out.getpoint(5, 5);
    expect(r).toBeGreaterThan(120);
    expect(a).toBe(200);
    scope.dispose();
  });

  it('desaturates to grey', () => {
    const red = vips.Image.black(4, 4, { bands: 3 })
      .linear(0, [200, 40, 40])
      .cast('uchar')
      .copy({ interpretation: 'srgb' });
    const { out, scope } = run({ adjust: { ...EMPTY_EDIT.adjust, saturation: -100 } }, red);
    const [r, g, b] = out.getpoint(1, 1);
    expect(Math.abs(r! - g!)).toBeLessThan(3);
    expect(Math.abs(g! - b!)).toBeLessThan(3);
    scope.dispose();
  });

  it('resizes and pads', () => {
    const { out, scope } = run({
      resize: { width: 40, height: 20 },
      pad: { top: 5, right: 5, bottom: 5, left: 5, color: '#ff0000' },
    });
    expect([out.width, out.height]).toEqual([50, 30]);
    expect(out.getpoint(0, 0)).toEqual([255, 0, 0]);
    scope.dispose();
  });
});
