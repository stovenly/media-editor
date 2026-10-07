import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Vips from 'wasm-vips';
import * as magickModule from '@imagemagick/magick-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { convertImage, type Engines } from '../../src/engine/image/convert';
import type { Magick, Vips as VipsInstance } from '../../src/engine/image/engines';
import { DEFAULT_IMAGE_SETTINGS, type ImageSettings } from '../../src/engine/image/settings';
import { TARGETS } from '../../src/engine/targets';
import { frameCount } from '../../src/io/frames';
import { sniff } from '../../src/io/sniff';

const FIXTURES = join(__dirname, '..', 'fixtures', 'generated');
const available = existsSync(FIXTURES);

let vips: VipsInstance;
let engines: Engines;

beforeAll(async () => {
  if (!available) return;
  vips = await Vips({ dynamicLibraries: ['vips-jxl.wasm', 'vips-heif.wasm', 'vips-resvg.wasm'] });
  vips.concurrency(1);
  await magickModule.initializeImageMagick(
    readFileSync(
      join(__dirname, '../../node_modules/@imagemagick/magick-wasm/dist/x86/magick.wasm'),
    ),
  );
  engines = { vips: async () => vips, magick: async () => magickModule as Magick };
}, 60_000);

async function inputOf(name: string) {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES, name)));
  const sniffed = await sniff(new File([bytes], name));
  return { bytes, format: sniffed.format!, pages: frameCount(sniffed.format!, bytes) };
}

async function convert(name: string, target: string, overrides: Partial<ImageSettings> = {}) {
  const input = await inputOf(name);
  return convertImage(
    { ...input, engines, onProgress: () => {} },
    { ...DEFAULT_IMAGE_SETTINGS, target, ...overrides },
  );
}

const EXPECTED_FORMAT: Record<string, string> = {
  'gif-anim': 'gif',
  'webp-anim': 'webp',
  favicon: 'zip',
  ppm: 'pnm',
};

const OUTPUTS = TARGETS.filter((t) => t.from.includes('image') && t.requires !== 'motion');
const AV = /^(clip|tone|subs)\.|\.(webm|srt)$/;
const INPUTS = available
  ? readdirSync(FIXTURES)
      .filter((name) => !AV.test(name))
      .sort()
  : [];

describe.skipIf(!available)('image conversion matrix', () => {
  for (const name of INPUTS) {
    it(`converts ${name} to every image output`, async () => {
      const failures: string[] = [];
      for (const out of OUTPUTS) {
        try {
          const result = await convert(name, out.id);
          expect(result.bytes.length).toBeGreaterThan(0);
          const sniffed = await sniff(
            new File([result.bytes as Uint8Array<ArrayBuffer>], `out.${out.ext}`),
          );
          const expected = EXPECTED_FORMAT[out.id] ?? out.id;
          const actual = sniffed.format === 'apng' && expected === 'png' ? 'png' : sniffed.format;
          if (out.id === 'favicon' || out.id === 'pdf' || out.id === 'frames') {
            expect(result.bytes[0]).toBe(out.id === 'pdf' ? 0x25 : 0x50);
          } else if (actual !== expected && !(expected === 'apng' && actual === 'png')) {
            failures.push(`${out.id}: got ${sniffed.format}`);
          }
        } catch (error) {
          failures.push(
            `${out.id}: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
          );
        }
      }
      expect(failures).toEqual([]);
    }, 120_000);
  }
});

describe.skipIf(!available)('image correctness', () => {
  it('removes EXIF, GPS and trailing bytes, and applies orientation once', async () => {
    const result = await convert('photo-gps.jpg', 'jpeg');
    const text = new TextDecoder('latin1').decode(result.bytes);
    expect(text).not.toContain('Exif');
    expect(text).not.toContain('TRAILING-SECRET');
    expect([result.width, result.height]).toEqual([48, 64]);
  });

  it('keeps metadata when asked', async () => {
    const result = await convert('photo-gps.jpg', 'jpeg', { metadata: 'all' });
    expect(new TextDecoder('latin1').decode(result.bytes)).toContain('Exif');
  });

  it('fills transparency with the background colour', async () => {
    const result = await convert('alpha.png', 'jpeg', { background: '#ff0000', quality: 95 });
    const image = vips.Image.newFromBuffer(result.bytes);
    const [r, g, b] = image.getpoint(0, 0);
    expect(r).toBeGreaterThan(230);
    expect(g).toBeLessThan(30);
    expect(b).toBeLessThan(30);
    expect(result.notes).toContain('Transparency was filled with the background colour');
  });

  it('keeps transparency in formats that support it', async () => {
    for (const target of ['png', 'webp', 'avif', 'tiff', 'qoi', 'tga']) {
      const result = await convert('alpha.png', target, { lossless: true });
      const decoded =
        target === 'qoi' || target === 'tga' ? null : vips.Image.newFromBuffer(result.bytes);
      if (decoded) expect(decoded.hasAlpha(), target).toBe(true);
    }
  });

  it('keeps every frame between animated formats', async () => {
    for (const [name, target] of [
      ['anim.gif', 'webp-anim'],
      ['anim.gif', 'apng'],
      ['anim.png', 'gif-anim'],
      ['anim.webp', 'apng'],
    ] as const) {
      const result = await convert(name, target);
      const format = target === 'apng' ? 'apng' : target.replace('-anim', '');
      expect(frameCount(format, result.bytes), `${name} → ${target}`).toBe(3);
    }
  });

  it('keeps only the first frame for still outputs, and says so', async () => {
    const result = await convert('anim.gif', 'png');
    expect(result.notes).toContain('Only the first frame was kept');
    expect(result.height).toBe(48);
  });

  it('resizes to the longest edge without enlarging', async () => {
    expect((await convert('alpha.png', 'png', { maxEdge: 32 })).width).toBe(32);
    expect((await convert('alpha.png', 'png', { maxEdge: 4000 })).width).toBe(64);
  });

  it('fits a lossy output under a target size', async () => {
    const big = await convert('gradient.jpg', 'jpeg', { quality: 100 });
    const limit = Math.floor(big.bytes.length * 0.6);
    const fitted = await convert('gradient.jpg', 'jpeg', { quality: 100, targetBytes: limit });
    expect(fitted.bytes.length).toBeLessThanOrEqual(limit);
    expect(fitted.quality).toBeLessThan(100);
  });

  it('scales down when quality alone cannot reach the target', async () => {
    const fitted = await convert('alpha.png', 'png', { targetBytes: 2000 });
    expect(fitted.bytes.length).toBeLessThanOrEqual(2000);
    expect(fitted.width).toBeLessThan(64);
  });

  it('writes icons with every size', async () => {
    const ico = await convert('shape.svg', 'ico');
    const view = new DataView(ico.bytes.buffer, ico.bytes.byteOffset);
    expect(view.getUint16(2, true)).toBe(1);
    expect(view.getUint16(4, true)).toBe(7);
    const cur = await convert('alpha.png', 'cur', { hotspot: { x: 4, y: 8 } });
    const curView = new DataView(cur.bytes.buffer, cur.bytes.byteOffset);
    expect(curView.getUint16(2, true)).toBe(2);
    expect([curView.getUint16(10, true), curView.getUint16(12, true)]).toEqual([4, 8]);
    const icns = await convert('alpha.png', 'icns');
    expect(new TextDecoder().decode(icns.bytes.subarray(0, 4))).toBe('icns');
  });

  it('reads its own ICNS output back', async () => {
    const icns = await convert('alpha.png', 'icns');
    const result = await convertImage(
      { bytes: icns.bytes, format: 'icns', pages: 1, engines, onProgress: () => {} },
      { ...DEFAULT_IMAGE_SETTINGS, target: 'png' },
    );
    expect(result.width).toBe(1024);
  });
});
