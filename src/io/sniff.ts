import { fileTypeFromBlob } from 'file-type';
import { FORMATS, type MediaKind } from './formats';

export type Sniffed = {
  format: string | null;
  kind: MediaKind | null;
  label: string;
};

const HEAD_BYTES = 4096;

type Signature = { format: string; test: (bytes: Uint8Array, text: string) => boolean };

const startsWith = (bytes: Uint8Array, prefix: number[], offset = 0) =>
  prefix.every((byte, i) => bytes[offset + i] === byte);

// Formats file-type does not recognise. Checked first, so keep each test strict.
const SIGNATURES: Signature[] = [
  { format: 'exr', test: (b) => startsWith(b, [0x76, 0x2f, 0x31, 0x01]) },
  { format: 'hdr', test: (_, t) => t.startsWith('#?RADIANCE') || t.startsWith('#?RGBE') },
  { format: 'dds', test: (_, t) => t.startsWith('DDS ') },
  { format: 'qoi', test: (_, t) => t.startsWith('qoif') },
  { format: 'fits', test: (_, t) => t.startsWith('SIMPLE  =') },
  { format: 'pnm', test: (_, t) => /^P[1-7]\s/.test(t) },
  { format: 'sgi', test: (b) => startsWith(b, [0x01, 0xda]) && (b[2] === 0 || b[2] === 1) },
  { format: 'sun', test: (b) => startsWith(b, [0x59, 0xa6, 0x6a, 0x95]) },
  { format: 'xpm', test: (_, t) => t.startsWith('/* XPM */') },
  { format: 'xbm', test: (_, t) => t.startsWith('#define') && t.includes('_width') },
  { format: 'tak', test: (_, t) => t.startsWith('tBaK') },
  { format: 'tta', test: (_, t) => t.startsWith('TTA1') },
  { format: 'caf', test: (_, t) => t.startsWith('caff') },
  { format: 'rf64', test: (_, t) => t.startsWith('RF64') || t.startsWith('BW64') },
  { format: 'w64', test: (b) => startsWith(b, [0x72, 0x69, 0x66, 0x66, 0x2e, 0x91, 0xcf, 0x11]) },
  { format: 'dts', test: (b) => startsWith(b, [0x7f, 0xfe, 0x80, 0x01]) },
  { format: 'dff', test: (_, t) => t.startsWith('FRM8') && t.slice(12, 16) === 'DSD ' },
  { format: 'nut', test: (_, t) => t.startsWith('nut/multimedia container') },
  { format: 'au', test: (_, t) => t.startsWith('.snd') },
  { format: 'svg', test: (_, t) => isSvg(t) },
];

// Formats with no usable signature, trusted by extension alone.
const BY_EXTENSION: Record<string, string> = {
  tga: 'tga',
  pcx: 'pcx',
  wbmp: 'wbmp',
  dv: 'dv',
  gsm: 'gsm',
};

// file-type extension → our format id. Identity mappings are omitted.
const FROM_FILE_TYPE: Record<string, string> = {
  jpg: 'jpeg',
  tif: 'tiff',
  j2c: 'jp2',
  jpx: 'jp2',
  jpm: 'jp2',
  aif: 'aiff',
  oga: 'ogg',
  m4p: 'm4a',
  f4a: 'm4a',
  f4b: 'm4b',
  f4v: 'mp4',
  f4p: 'mp4',
  mp1: 'mp3',
  mp2: 'mp3',
  '3g2': '3gp',
  ogm: 'ogv',
};

// file-type matches on so few bytes that a signatureless format can collide
// with them: an uncompressed TGA header begins exactly like a CUR file.
const WEAK_MATCHES = new Set(['ico', 'cur']);

const TIFF_BASED_RAW = new Set(['pef', 'srw', 'nef', 'arw', 'dng', 'cr2', 'orf', 'rw2']);

const NOT_YET: Record<string, string> = {
  mid: 'MIDI',
  it: 'Tracker module',
  s3m: 'Tracker module',
  xm: 'Tracker module',
  xcf: 'GIMP image',
  vtt: 'Subtitles',
};

function isSvg(text: string): boolean {
  const start = text.replace(/^\uFEFF/, '').trimStart();
  if (!start.startsWith('<')) return false;
  return /<svg[\s>]/i.test(start);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function known(format: string): Sniffed {
  const info = FORMATS[format];
  return info ? { format, kind: info.kind, label: info.label } : unknown(format);
}

function unknown(name: string, label?: string): Sniffed {
  return {
    format: null,
    kind: null,
    label: label ?? (name ? `${name.toUpperCase()} file` : 'Unknown file'),
  };
}

export async function sniff(file: Blob & { name?: string }): Promise<Sniffed> {
  const extension = extensionOf(file.name ?? '');
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const text = new TextDecoder('latin1').decode(head);

  const signature = SIGNATURES.find((entry) => entry.test(head, text));
  if (signature) return known(signature.format);

  const detected = await fileTypeFromBlob(file);
  if (detected) {
    const { ext, mime } = detected;
    const byExtension = BY_EXTENSION[extension];
    if (byExtension && WEAK_MATCHES.has(ext)) return known(byExtension);
    if (NOT_YET[ext]) return unknown(ext, `${NOT_YET[ext]} (not supported yet)`);
    if (ext === 'xml') return unknown(extension);
    if (ext === 'asf') return known(mime.startsWith('audio/') ? 'wma' : 'wmv');
    if (ext === 'rm') return known(extension === 'ra' ? 'ra' : 'rm');
    if (ext === '3gp' && extension === '3ga') return known('m4a');
    if (ext === 'tif' && TIFF_BASED_RAW.has(extension)) return known(extension);
    return known(FROM_FILE_TYPE[ext] ?? ext);
  }

  const byExtension = BY_EXTENSION[extension];
  return byExtension ? known(byExtension) : unknown(extension);
}
