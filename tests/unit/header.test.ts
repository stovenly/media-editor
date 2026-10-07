import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { imageHeader } from '../../src/io/header';

const bytes = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, '../fixtures/generated', name)));

describe('imageHeader', () => {
  it.each([
    ['alpha.png', 'png', { width: 64, height: 48, alpha: true }],
    ['anim.png', 'apng', { width: 64, height: 48, alpha: true }],
    ['gradient.jpg', 'jpeg', { width: 64, height: 48, alpha: false }],
    ['photo-gps.jpg', 'jpeg', { width: 64, height: 48, alpha: false }],
    ['alpha.webp', 'webp', { width: 64, height: 48, alpha: true }],
    ['anim.gif', 'gif', { width: 64, height: 48 }],
    ['gradient.bmp', 'bmp', { width: 64, height: 48 }],
  ] as const)('reads %s', (name, format, expected) => {
    expect(imageHeader(bytes(name), format)).toEqual(expected);
  });

  it('gives up on formats it does not parse and on truncated files', () => {
    expect(imageHeader(bytes('gradient.jpg'), 'tiff')).toBeNull();
    expect(imageHeader(bytes('alpha.png').subarray(0, 10), 'png')).toBeNull();
  });
});
