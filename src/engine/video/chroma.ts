// Chroma keying on RGBA pixels: colours near the key go transparent, and the key's tint is pulled out of
// what remains. A pixel's keyness is how far its CbCr colour leans towards the key's hue, less how far it
// leans sideways, relative to the key itself; brightness doesn't enter, so shadows on the screen key too.
import type { ChromaKey } from '../../project/video';

const SOFT_RANGE = 0.5; // keyness span that smoothness 1 stands for

export function chromaOf(hex: string): [number, number] {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return [-0.168736 * r - 0.331264 * g + 0.5 * b, 0.5 * r - 0.418688 * g - 0.081312 * b];
}

export function applyChromaKey(data: Uint8ClampedArray, key: ChromaKey): void {
  const [kcb, kcr] = chromaOf(key.color);
  const length = Math.hypot(kcb, kcr) || 1;
  const ux = kcb / length;
  const uy = kcr / length;
  const threshold = 1 - key.similarity;
  const soft = Math.max(1e-4, key.smoothness * SOFT_RANGE);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]! / 255;
    const g = data[i + 1]! / 255;
    const b = data[i + 2]! / 255;
    let cb = -0.168736 * r - 0.331264 * g + 0.5 * b;
    let cr = 0.5 * r - 0.418688 * g - 0.081312 * b;
    const along = cb * ux + cr * uy;
    const across = Math.abs(cb * uy - cr * ux);
    const keyness = (along - across) / length;
    const alpha = Math.min(1, Math.max(0, (threshold - keyness) / soft));
    if (alpha === 0) {
      data[i + 3] = 0;
      continue;
    }
    if (key.spill > 0 && along > 0) {
      cb -= ux * along * key.spill;
      cr -= uy * along * key.spill;
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      data[i] = (y + 1.402 * cr) * 255;
      data[i + 1] = (y - 0.344136 * cb - 0.714136 * cr) * 255;
      data[i + 2] = (y + 1.772 * cb) * 255;
    }
    data[i + 3] = data[i + 3]! * alpha;
  }
}
