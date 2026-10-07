// Animated PNG: split into standalone PNG frames, and assemble frames back into one file.
export type ApngFrame = {
  png: Uint8Array;
  x: number;
  y: number;
  width: number;
  height: number;
  delayMs: number;
  dispose: 0 | 1 | 2; // none, background, previous
  blend: 0 | 1; // source, over
};

export type Apng = { width: number; height: number; loops: number; frames: ApngFrame[] };

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

type Chunk = { type: string; data: Uint8Array };

function readChunks(bytes: Uint8Array): Chunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    chunks.push({ type, data: bytes.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(parts: readonly Uint8Array[]): number {
  let crc = 0xffffffff;
  for (const part of parts)
    for (const byte of part) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const typeBytes = Uint8Array.from(type, (c) => c.charCodeAt(0));
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32([typeBytes, data]));
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

function delayOf(view: DataView, at: number): number {
  const num = view.getUint16(at);
  const den = view.getUint16(at + 2) || 100;
  return Math.round((num / den) * 1000);
}

// Chunks that describe the whole image and are copied into every standalone frame.
const SHARED = new Set(['PLTE', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'cICP', 'sBIT']);

export function splitApng(bytes: Uint8Array): Apng {
  const chunks = readChunks(bytes);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('Damaged PNG');
  const header = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  const width = header.getUint32(0);
  const height = header.getUint32(4);
  const actl = chunks.find((c) => c.type === 'acTL');
  const loops = actl ? new DataView(actl.data.buffer, actl.data.byteOffset).getUint32(4) : 0;
  const shared = chunks.filter((c) => SHARED.has(c.type));

  const frames: ApngFrame[] = [];
  let current: (Omit<ApngFrame, 'png'> & { data: Uint8Array[] }) | null = null;
  const flush = () => {
    if (!current || current.data.length === 0) return;
    const ihdrData = ihdr.data.slice();
    const view = new DataView(ihdrData.buffer);
    view.setUint32(0, current.width);
    view.setUint32(4, current.height);
    const png = concat([
      SIGNATURE,
      chunk('IHDR', ihdrData),
      ...shared.map((c) => chunk(c.type, c.data)),
      ...current.data.map((data) => chunk('IDAT', data)),
      chunk('IEND', new Uint8Array()),
    ]);
    const { x, y, width: w, height: h, delayMs, dispose, blend } = current;
    frames.push({ png, x, y, width: w, height: h, delayMs, dispose, blend });
  };

  for (const c of chunks) {
    if (c.type === 'fcTL') {
      flush();
      const view = new DataView(c.data.buffer, c.data.byteOffset, c.data.byteLength);
      current = {
        width: view.getUint32(4),
        height: view.getUint32(8),
        x: view.getUint32(12),
        y: view.getUint32(16),
        delayMs: delayOf(view, 20),
        dispose: (c.data[24]! as 0 | 1 | 2) ?? 0,
        blend: (c.data[25]! as 0 | 1) ?? 0,
        data: [],
      };
    } else if (c.type === 'IDAT') {
      if (current && frames.length === 0) current.data.push(c.data);
    } else if (c.type === 'fdAT' && current) {
      current.data.push(c.data.subarray(4));
    }
  }
  flush();
  if (frames.length === 0) {
    return {
      width,
      height,
      loops,
      frames: [{ png: bytes, x: 0, y: 0, width, height, delayMs: 100, dispose: 0, blend: 0 }],
    };
  }
  return { width, height, loops, frames };
}

// Frames must be full-size PNGs with identical headers; each becomes one APNG frame.
export function assembleApng(
  frames: readonly Uint8Array[],
  delaysMs: readonly number[],
  loops = 0,
): Uint8Array {
  if (frames.length === 0) throw new Error('No frames');
  const first = readChunks(frames[0]!);
  const ihdr = first.find((c) => c.type === 'IHDR')!;
  const header = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  const width = header.getUint32(0);
  const height = header.getUint32(4);
  const parts: Uint8Array[] = [SIGNATURE, chunk('IHDR', ihdr.data)];
  for (const c of first) if (SHARED.has(c.type)) parts.push(chunk(c.type, c.data));
  const actl = new Uint8Array(8);
  new DataView(actl.buffer).setUint32(0, frames.length);
  new DataView(actl.buffer).setUint32(4, loops);
  parts.push(chunk('acTL', actl));

  let sequence = 0;
  frames.forEach((png, index) => {
    const fctl = new Uint8Array(26);
    const view = new DataView(fctl.buffer);
    view.setUint32(0, sequence++);
    view.setUint32(4, width);
    view.setUint32(8, height);
    view.setUint16(20, Math.max(1, Math.round(delaysMs[index] ?? 100)));
    view.setUint16(22, 1000);
    parts.push(chunk('fcTL', fctl));
    for (const c of readChunks(png)) {
      if (c.type !== 'IDAT') continue;
      if (index === 0) {
        parts.push(chunk('IDAT', c.data));
      } else {
        const data = new Uint8Array(4 + c.data.length);
        new DataView(data.buffer).setUint32(0, sequence++);
        data.set(c.data, 4);
        parts.push(chunk('fdAT', data));
      }
    }
  });
  parts.push(chunk('IEND', new Uint8Array()));
  return concat(parts);
}
