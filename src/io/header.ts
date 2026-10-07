// Size and transparency read straight from an image header, for when the browser can't decode the file in a worker.

export type HeaderInfo = { width: number; height: number; alpha?: boolean };

const ascii = (b: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...b.subarray(at, at + n));

export function imageHeader(bytes: Uint8Array, format: string): HeaderInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    switch (format) {
      case 'png':
      case 'apng':
        return png(bytes, view);
      case 'gif':
        return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
      case 'jpeg':
        return jpeg(bytes, view);
      case 'webp':
        return webp(bytes, view);
      case 'bmp':
        return bmp(view);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// Colour types 4 and 6 carry alpha; a tRNS chunk adds it to the others.
function png(bytes: Uint8Array, view: DataView): HeaderInfo | null {
  if (ascii(bytes, 12, 4) !== 'IHDR') return null;
  const info: HeaderInfo = {
    width: view.getUint32(16),
    height: view.getUint32(20),
    alpha: bytes[25] === 4 || bytes[25] === 6,
  };
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at);
    const type = ascii(bytes, at + 4, 4);
    if (type === 'tRNS') info.alpha = true;
    if (type === 'IDAT' || type === 'IEND') break;
    at += 12 + length;
  }
  return info;
}

function jpeg(bytes: Uint8Array, view: DataView): HeaderInfo | null {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame)
      return { width: view.getUint16(at + 7), height: view.getUint16(at + 5), alpha: false };
    at += 2 + view.getUint16(at + 2);
  }
  return null;
}

function webp(bytes: Uint8Array, view: DataView): HeaderInfo | null {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X') {
    const u24 = (at: number) => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
    return { width: u24(24) + 1, height: u24(27) + 1, alpha: (bytes[20]! & 0x10) !== 0 };
  }
  if (chunk === 'VP8L') {
    const bits = view.getUint32(21, true);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      alpha: ((bits >> 28) & 1) === 1,
    };
  }
  if (chunk === 'VP8 ')
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
      alpha: false,
    };
  return null;
}

// Height is negative for top-down bitmaps.
function bmp(view: DataView): HeaderInfo | null {
  const headerSize = view.getUint32(14, true);
  if (headerSize === 12)
    return { width: view.getUint16(18, true), height: view.getUint16(20, true) };
  return { width: view.getInt32(18, true), height: Math.abs(view.getInt32(22, true)) };
}
