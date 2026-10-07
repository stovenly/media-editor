// Removes metadata from encoded images after encoding, including bytes after the end marker.
export type Keep = { icc: boolean };

export function stripImage(bytes: Uint8Array, mime: string, keep: Keep): Uint8Array {
  if (mime === 'image/jpeg') return stripJpeg(bytes, keep);
  if (mime === 'image/png' || mime === 'image/apng') return stripPng(bytes, keep);
  if (mime === 'image/webp') return stripWebp(bytes, keep);
  return bytes;
}

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;

function isAscii(bytes: Uint8Array, at: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

function keepJpegSegment(marker: number, bytes: Uint8Array, body: number, keep: Keep): boolean {
  if (marker === 0xe0) return isAscii(bytes, body, 'JFIF\0');
  if (marker === 0xe2) return keep.icc && isAscii(bytes, body, 'ICC_PROFILE\0');
  // Adobe APP14 says how to interpret CMYK and YCCK data; it carries no personal data.
  if (marker === 0xee) return isAscii(bytes, body, 'Adobe');
  if (marker >= 0xe0 && marker <= 0xef) return false;
  return marker !== 0xfe;
}

export function stripJpeg(bytes: Uint8Array, keep: Keep): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== SOI) return bytes;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 2 <= bytes.length) {
    if (bytes[i] !== 0xff) throw new Error('Damaged JPEG');
    const marker = bytes[i + 1]!;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === EOI) {
      parts.push(bytes.subarray(i, i + 2));
      return concat(parts);
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(bytes.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    let end = i + 2 + length;
    if (marker === SOS) end = scanEntropy(bytes, end);
    if (keepJpegSegment(marker, bytes, i + 4, keep)) parts.push(bytes.subarray(i, end));
    i = end;
  }
  throw new Error('JPEG has no end marker');
}

// Returns the offset of the first marker after entropy-coded data (FF00 is a stuffed byte, FFD0–FFD7 are restarts).
function scanEntropy(bytes: Uint8Array, from: number): number {
  for (let i = from; i + 1 < bytes.length; i++) {
    if (bytes[i] !== 0xff) continue;
    const next = bytes[i + 1]!;
    if (next === 0 || (next >= 0xd0 && next <= 0xd7) || next === 0xff) continue;
    return i;
  }
  return bytes.length;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_KEPT = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'cICP',
  'mDCV',
  'cLLI',
  'sBIT',
  'bKGD',
  'pHYs',
  'acTL',
  'fcTL',
  'fdAT',
]);

export function stripPng(bytes: Uint8Array, keep: Keep): Uint8Array {
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= bytes.length) {
    const length = view.getUint32(i);
    const type = String.fromCharCode(...bytes.subarray(i + 4, i + 8));
    const end = i + 12 + length;
    if (PNG_KEPT.has(type) || (type === 'iCCP' && keep.icc)) parts.push(bytes.subarray(i, end));
    if (type === 'IEND') return concat(parts);
    i = end;
  }
  throw new Error('PNG has no end chunk');
}

const WEBP_KEPT = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF']);
const VP8X_ICC = 0x20;
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

export function stripWebp(bytes: Uint8Array, keep: Keep): Uint8Array {
  if (!isAscii(bytes, 0, 'RIFF') || !isAscii(bytes, 8, 'WEBP')) return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = Math.min(bytes.length, 8 + view.getUint32(4, true));
  const parts: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= riffEnd) {
    const type = String.fromCharCode(...bytes.subarray(i, i + 4));
    const size = view.getUint32(i + 4, true);
    const end = Math.min(riffEnd, i + 8 + size + (size & 1));
    if (WEBP_KEPT.has(type) || (type === 'ICCP' && keep.icc)) {
      const chunk = bytes.slice(i, end);
      if (type === 'VP8X') chunk[8]! &= ~(VP8X_EXIF | VP8X_XMP | (keep.icc ? 0 : VP8X_ICC));
      parts.push(chunk);
    }
    i = end;
  }
  const body = concat(parts);
  const out = new Uint8Array(12 + body.length);
  out.set(bytes.subarray(0, 12));
  new DataView(out.buffer).setUint32(4, 4 + body.length, true);
  out.set(body, 12);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
