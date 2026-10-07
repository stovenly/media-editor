// Counts animation frames from file headers without decoding pixels.
export function frameCount(format: string, bytes: Uint8Array): number {
  if (format === 'gif') return gifFrames(bytes);
  if (format === 'apng' || format === 'png') return apngFrames(bytes);
  if (format === 'webp') return webpFrames(bytes);
  return 1;
}

function gifFrames(bytes: Uint8Array): number {
  if (bytes.length < 13) return 1;
  let at = 13;
  const flags = bytes[10]!;
  if (flags & 0x80) at += 3 * (1 << ((flags & 7) + 1));
  let frames = 0;
  while (at < bytes.length) {
    const block = bytes[at]!;
    if (block === 0x3b) break;
    if (block === 0x21) {
      at += 2;
      at = skipSubBlocks(bytes, at);
    } else if (block === 0x2c) {
      frames += 1;
      const local = bytes[at + 9]!;
      at += 10;
      if (local & 0x80) at += 3 * (1 << ((local & 7) + 1));
      at += 1;
      at = skipSubBlocks(bytes, at);
    } else break;
  }
  return Math.max(1, frames);
}

function skipSubBlocks(bytes: Uint8Array, at: number): number {
  while (at < bytes.length) {
    const size = bytes[at]!;
    at += 1 + size;
    if (size === 0) break;
  }
  return at;
}

function apngFrames(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === 'acTL') return Math.max(1, view.getUint32(at + 8));
    if (type === 'IDAT' || type === 'IEND') return 1;
    at += 12 + length;
  }
  return 1;
}

function webpFrames(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let frames = 0;
  for (let at = 12; at + 8 <= bytes.length;) {
    const type = String.fromCharCode(...bytes.subarray(at, at + 4));
    const size = view.getUint32(at + 4, true);
    if (type === 'ANMF') frames += 1;
    at += 8 + size + (size & 1);
  }
  return Math.max(1, frames);
}
