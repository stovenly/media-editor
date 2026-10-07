// Reads ZIP archives lazily from a Blob: stored entries are slices, deflated ones stream through DecompressionStream.

export type ZipFileEntry = { name: string; size: number; read(): Promise<Blob> };

const EOCD = 0x06054b50;
const EOCD64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const TAIL = 65_557; // EOCD (22) plus the longest comment

export async function readZip(zip: Blob): Promise<ZipFileEntry[]> {
  const tailStart = Math.max(0, zip.size - TAIL);
  const tail = new DataView(await zip.slice(tailStart).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--)
    if (tail.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("This isn't a ZIP file");

  let count = tail.getUint16(eocd + 10, true);
  let dirSize = tail.getUint32(eocd + 12, true);
  let dirOffset = tail.getUint32(eocd + 16, true);
  if (eocd >= 20 && tail.getUint32(eocd - 20, true) === EOCD64_LOCATOR) {
    const at = Number(tail.getBigUint64(eocd - 12, true));
    const record = new DataView(await zip.slice(at, at + 56).arrayBuffer());
    count = Number(record.getBigUint64(32, true));
    dirSize = Number(record.getBigUint64(40, true));
    dirOffset = Number(record.getBigUint64(48, true));
  }

  const dir = new DataView(await zip.slice(dirOffset, dirOffset + dirSize).arrayBuffer());
  const decoder = new TextDecoder();
  const entries: ZipFileEntry[] = [];
  let at = 0;
  for (let n = 0; n < count && at + 46 <= dir.byteLength; n++) {
    if (dir.getUint32(at, true) !== CENTRAL) throw new Error('This ZIP file is damaged');
    const method = dir.getUint16(at + 10, true);
    let compressed = dir.getUint32(at + 20, true);
    let size = dir.getUint32(at + 24, true);
    const nameLength = dir.getUint16(at + 28, true);
    const extraLength = dir.getUint16(at + 30, true);
    const commentLength = dir.getUint16(at + 32, true);
    let local = dir.getUint32(at + 42, true);
    const name = decoder.decode(new Uint8Array(dir.buffer, dir.byteOffset + at + 46, nameLength));
    // ZIP64 extra field: the 64-bit values appear in this order, only for fields saturated at 0xffffffff.
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = dir.getUint16(extra, true);
      const length = dir.getUint16(extra + 2, true);
      if (id === 1) {
        let p = extra + 4;
        if (size === 0xffffffff) {
          size = Number(dir.getBigUint64(p, true));
          p += 8;
        }
        if (compressed === 0xffffffff) {
          compressed = Number(dir.getBigUint64(p, true));
          p += 8;
        }
        if (local === 0xffffffff) local = Number(dir.getBigUint64(p, true));
      }
      extra += 4 + length;
    }
    at = extraEnd + commentLength;
    if (name.endsWith('/')) continue;
    if (method !== 0 && method !== 8)
      throw new Error(`${name} uses a compression this app can't read`);
    const localOffset = local;
    const compressedSize = compressed;
    entries.push({
      name,
      size,
      async read() {
        const header = new DataView(await zip.slice(localOffset, localOffset + 30).arrayBuffer());
        if (header.getUint32(0, true) !== LOCAL) throw new Error('This ZIP file is damaged');
        const start = localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
        const data = zip.slice(start, start + compressedSize);
        if (method === 0) return data;
        const stream = data.stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Response(stream).blob();
      },
    });
  }
  return entries;
}
