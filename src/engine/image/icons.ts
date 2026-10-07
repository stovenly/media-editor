// ICO, CUR and ICNS containers around PNG-encoded entries.
export type IconEntry = { size: number; png: Uint8Array };

// hotspot is in pixels of each entry, measured from the top left.
export function writeIco(
  entries: readonly IconEntry[],
  cursor?: { x: number; y: number },
): Uint8Array {
  const sorted = [...entries].sort((a, b) => a.size - b.size);
  const header = 6 + 16 * sorted.length;
  const total = header + sorted.reduce((sum, entry) => sum + entry.png.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(2, cursor ? 2 : 1, true);
  view.setUint16(4, sorted.length, true);
  let offset = header;
  sorted.forEach((entry, index) => {
    const at = 6 + index * 16;
    out[at] = entry.size >= 256 ? 0 : entry.size;
    out[at + 1] = entry.size >= 256 ? 0 : entry.size;
    if (cursor) {
      const scale = entry.size / 32;
      view.setUint16(at + 4, Math.round(cursor.x * scale), true);
      view.setUint16(at + 6, Math.round(cursor.y * scale), true);
    } else {
      view.setUint16(at + 4, 1, true);
      view.setUint16(at + 6, 32, true);
    }
    view.setUint32(at + 8, entry.png.length, true);
    view.setUint32(at + 12, offset, true);
    out.set(entry.png, offset);
    offset += entry.png.length;
  });
  return out;
}

// Pixel size of each ICNS PNG type; the @2x types share a pixel size with a 1x type.
export const ICNS_TYPES: readonly (readonly [string, number])[] = [
  ['icp4', 16],
  ['icp5', 32],
  ['ic11', 32],
  ['icp6', 64],
  ['ic12', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic13', 256],
  ['ic09', 512],
  ['ic14', 512],
  ['ic10', 1024],
];

export function writeIcns(entries: readonly IconEntry[]): Uint8Array {
  const bySize = new Map(entries.map((entry) => [entry.size, entry.png]));
  const chunks = ICNS_TYPES.flatMap(([type, size]) => {
    const png = bySize.get(size);
    return png ? [{ type, png }] : [];
  });
  const total = 8 + chunks.reduce((sum, chunk) => sum + 8 + chunk.png.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  writeAscii(out, 0, 'icns');
  view.setUint32(4, total);
  let at = 8;
  for (const chunk of chunks) {
    writeAscii(out, at, chunk.type);
    view.setUint32(at + 4, 8 + chunk.png.length);
    out.set(chunk.png, at + 8);
    at += 8 + chunk.png.length;
  }
  return out;
}

// The largest PNG or JPEG 2000 entry in an ICNS file. Older RLE-packed entries are skipped.
export function largestIcnsImage(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sizes = new Map(ICNS_TYPES);
  let best: Uint8Array | null = null;
  let bestSize = 0;
  for (let at = 8; at + 8 <= bytes.length;) {
    const type = String.fromCharCode(...bytes.subarray(at, at + 4));
    const length = view.getUint32(at + 4);
    if (length < 8) break;
    const data = bytes.subarray(at + 8, at + length);
    const size = sizes.get(type) ?? 0;
    const encoded = data[0] === 0x89 || (data[4] === 0x6a && data[5] === 0x50);
    if (encoded && size > bestSize) {
      best = data;
      bestSize = size;
    }
    at += length;
  }
  return best;
}

function writeAscii(out: Uint8Array, at: number, text: string): void {
  for (let i = 0; i < text.length; i++) out[at + i] = text.charCodeAt(i);
}
