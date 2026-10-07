// Finds subtitle tracks in MP4/MOV and Matroska/WebM by walking the container headers, without decoding.

export type SubtitleTrack = {
  codec: string;
  language: string | null;
  text: boolean; // false for bitmap subtitles (PGS, VobSub, DVB), which can't become text
};

const MOOV_LIMIT = 64 * 1024 * 1024;
const EBML_WINDOW = 8 * 1024 * 1024;

export async function subtitleTracks(file: Blob): Promise<SubtitleTrack[]> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3)
    return matroska(file);
  if (ascii(head, 4, 4) === 'ftyp' || ['moov', 'mdat', 'wide', 'free'].includes(ascii(head, 4, 4)))
    return mp4(file);
  return [];
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let out = '';
  for (let i = at; i < at + length && i < bytes.length; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

async function mp4(file: Blob): Promise<SubtitleTrack[]> {
  let at = 0;
  while (at + 8 <= file.size) {
    const header = new DataView(await file.slice(at, at + 16).arrayBuffer());
    let size = header.getUint32(0);
    const type = String.fromCharCode(
      header.getUint8(4),
      header.getUint8(5),
      header.getUint8(6),
      header.getUint8(7),
    );
    let offset = 8;
    if (size === 1 && header.byteLength >= 16) {
      size = Number(header.getBigUint64(8));
      offset = 16;
    } else if (size === 0) {
      size = file.size - at;
    }
    if (size < offset) return [];
    if (type === 'moov') {
      if (size > MOOV_LIMIT) return [];
      const moov = new Uint8Array(await file.slice(at + offset, at + size).arrayBuffer());
      return tracksInMoov(moov);
    }
    at += size;
  }
  return [];
}

type Box = { type: string; start: number; end: number };

function* boxes(bytes: Uint8Array, start: number, end: number): Generator<Box> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    let offset = 8;
    if (size === 1 && at + 16 <= end) {
      size = Number(view.getBigUint64(at + 8));
      offset = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < offset || at + size > end) return;
    yield { type: ascii(bytes, at + 4, 4), start: at + offset, end: at + size };
    at += size;
  }
}

function child(bytes: Uint8Array, parent: Box, type: string): Box | undefined {
  for (const box of boxes(bytes, parent.start, parent.end)) if (box.type === type) return box;
  return undefined;
}

const SUBTITLE_HANDLERS = new Set(['sbtl', 'text', 'subt', 'clcp']);

function tracksInMoov(moov: Uint8Array): SubtitleTrack[] {
  const tracks: SubtitleTrack[] = [];
  for (const trak of boxes(moov, 0, moov.length)) {
    if (trak.type !== 'trak') continue;
    const mdia = child(moov, trak, 'mdia');
    const hdlr = mdia && child(moov, mdia, 'hdlr');
    if (!mdia || !hdlr) continue;
    const handler = ascii(moov, hdlr.start + 8, 4);
    if (!SUBTITLE_HANDLERS.has(handler)) continue;
    const stbl = child(moov, child(moov, mdia, 'minf') ?? mdia, 'stbl');
    const stsd = stbl && child(moov, stbl, 'stsd');
    const codec = stsd ? ascii(moov, stsd.start + 12, 4) : handler;
    tracks.push({ codec, language: mp4Language(moov, mdia), text: codec !== 'mp4s' });
  }
  return tracks;
}

function mp4Language(bytes: Uint8Array, mdia: Box): string | null {
  const mdhd = child(bytes, mdia, 'mdhd');
  if (!mdhd) return null;
  const version = bytes[mdhd.start]!;
  const at = mdhd.start + (version === 1 ? 32 : 20);
  const packed = (bytes[at]! << 8) | bytes[at + 1]!;
  const code = String.fromCharCode(
    ((packed >> 10) & 31) + 0x60,
    ((packed >> 5) & 31) + 0x60,
    (packed & 31) + 0x60,
  );
  return /^[a-z]{3}$/.test(code) && code !== 'und' ? code : null;
}

const SEGMENT = 0x18538067;
const TRACKS = 0x1654ae6b;
const CLUSTER = 0x1f43b675;
const TRACK_ENTRY = 0xae;
const TRACK_TYPE = 0x83;
const CODEC_ID = 0x86;
const LANGUAGE = 0x22b59c;
const LANGUAGE_BCP47 = 0x22b59d;
const SUBTITLE_TYPE = 17;

type Element = { id: number; start: number; end: number };

function vint(bytes: Uint8Array, at: number, keepMarker: boolean) {
  const first = bytes[at];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (!(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || at + length > bytes.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let unknown = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[at + i]!;
    unknown &&= bytes[at + i] === 0xff;
  }
  return { value, length, unknown: !keepMarker && unknown };
}

function* elements(bytes: Uint8Array, start: number, end: number): Generator<Element> {
  let at = start;
  while (at < end) {
    const id = vint(bytes, at, true);
    if (!id) return;
    const size = vint(bytes, at + id.length, false);
    if (!size) return;
    const body = at + id.length + size.length;
    const close = size.unknown ? end : Math.min(end, body + size.value);
    yield { id: id.value, start: body, end: close };
    at = close;
  }
}

async function matroska(file: Blob): Promise<SubtitleTrack[]> {
  const bytes = new Uint8Array(await file.slice(0, EBML_WINDOW).arrayBuffer());
  for (const top of elements(bytes, 0, bytes.length)) {
    if (top.id !== SEGMENT) continue;
    for (const element of elements(bytes, top.start, top.end)) {
      if (element.id === CLUSTER) return [];
      if (element.id === TRACKS) return tracksInMatroska(bytes, element);
    }
  }
  return [];
}

const BITMAP = /^S_(HDMV|VOBSUB|DVBSUB|IMAGE)/;

function tracksInMatroska(bytes: Uint8Array, tracks: Element): SubtitleTrack[] {
  const found: SubtitleTrack[] = [];
  const text = (e: Element) => ascii(bytes, e.start, e.end - e.start).replace(/\0+$/, '');
  for (const entry of elements(bytes, tracks.start, tracks.end)) {
    if (entry.id !== TRACK_ENTRY) continue;
    let type = 0;
    let codec = '';
    let language: string | null = null;
    for (const field of elements(bytes, entry.start, entry.end)) {
      if (field.id === TRACK_TYPE) type = bytes[field.start] ?? 0;
      else if (field.id === CODEC_ID) codec = text(field);
      else if (field.id === LANGUAGE_BCP47 || (field.id === LANGUAGE && !language))
        language = text(field);
    }
    if (type !== SUBTITLE_TYPE) continue;
    found.push({
      codec,
      language: language && language !== 'und' ? language : null,
      text: !BITMAP.test(codec),
    });
  }
  return found;
}
