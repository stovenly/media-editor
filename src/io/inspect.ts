// Everything the file card shows before conversion. Runs in the inspect worker.
import { parseSubtitles, writeSubtitles, type Cue, type SubtitleFormat } from '../captions/cues';
import { probeAv, type AvProbe } from '../media/probe';
import { readMetadata, type MetadataSummary } from '../metadata/read';
import { frameCount } from './frames';
import { sniff, type Sniffed } from './sniff';

export type Inspection = {
  sniffed: Sniffed;
  width?: number;
  height?: number;
  pages: number;
  duration?: number; // seconds
  alpha?: boolean;
  thumbnail?: Blob;
  metadata?: MetadataSummary;
  av?: AvProbe;
  motionOffset?: number; // byte offset of the MP4 embedded in a Motion Photo
  cues?: number;
};

const THUMB = 96;
const AUDIO_CAPABLE = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', '3gp']);
const METADATA_LIMIT = 256 * 1024 * 1024;
const SUBTITLE_LIMIT = 32 * 1024 * 1024;
const BROWSER_DECODES = new Set(['jpeg', 'png', 'apng', 'gif', 'webp', 'avif', 'bmp', 'ico']);

export async function inspect(file: File): Promise<Inspection> {
  const sniffed = await sniff(file);
  const result: Inspection = { sniffed, pages: 1 };
  if (sniffed.kind === 'subtitle') {
    if (file.size > SUBTITLE_LIMIT) throw new Error('This subtitle file is too large');
    const cues = parseSubtitles(await file.text(), sniffed.format as SubtitleFormat);
    result.cues = cues.length;
    result.duration = cues.reduce((end, cue) => Math.max(end, cue.end), 0);
    return result;
  }
  if (sniffed.kind === 'audio' || sniffed.kind === 'video') {
    const probed = await probeAv(file, THUMB);
    if (!probed) return result;
    const { probe, thumbnail } = probed;
    result.av = probe;
    result.duration = probe.duration;
    result.thumbnail = thumbnail;
    if (probe.video) {
      result.width = probe.video.width;
      result.height = probe.video.height;
      result.alpha = probe.video.alpha;
    }
    if (sniffed.kind === 'video' && !probe.video) {
      // MP4-family files are often audio-only; elsewhere a missing video track means Mediabunny can't see it.
      if (AUDIO_CAPABLE.has(sniffed.format ?? '') && probe.audio) {
        result.sniffed = {
          ...sniffed,
          kind: 'audio',
          label: sniffed.label.replace('video', 'audio'),
        };
      } else {
        probe.native = false;
      }
    }
    return result;
  }
  if (sniffed.kind !== 'image') return result;

  if (file.size <= METADATA_LIMIT) {
    const buffer = await file.arrayBuffer();
    result.pages = frameCount(sniffed.format ?? '', new Uint8Array(buffer));
    result.metadata = readMetadata(buffer);
    if (result.metadata.motion && sniffed.format === 'jpeg')
      result.motionOffset = embeddedMp4(new Uint8Array(buffer));
  }
  if (BROWSER_DECODES.has(sniffed.format ?? '')) {
    try {
      Object.assign(result, await browserThumbnail(file));
    } catch {
      // Left to the image engine.
    }
  }
  return result;
}

async function browserThumbnail(file: File) {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const scale = Math.min(1, THUMB / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const pixels = context.getImageData(0, 0, w, h).data;
  let alpha = false;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i]! < 255) {
      alpha = true;
      break;
    }
  }
  const thumbnail = await canvas.convertToBlob({ type: 'image/png' });
  return { width, height, alpha, thumbnail };
}

export async function readCues(file: File): Promise<Cue[]> {
  if (file.size > SUBTITLE_LIMIT) throw new Error('This subtitle file is too large');
  return parseSubtitles(await file.text());
}

export async function convertSubtitles(file: File, to: SubtitleFormat): Promise<string> {
  return writeSubtitles(parseSubtitles(await file.text()), to);
}

// The MP4 a Motion Photo appends after its JPEG: the first plausible `ftyp` box past the image data.
export function embeddedMp4(bytes: Uint8Array): number | undefined {
  for (let at = 1024; at + 12 <= bytes.length; at++) {
    if (
      bytes[at] !== 0x66 ||
      bytes[at + 1] !== 0x74 ||
      bytes[at + 2] !== 0x79 ||
      bytes[at + 3] !== 0x70
    )
      continue;
    const start = at - 4;
    const size =
      ((bytes[start]! << 24) |
        (bytes[start + 1]! << 16) |
        (bytes[start + 2]! << 8) |
        bytes[start + 3]!) >>>
      0;
    if (size >= 16 && size <= 64) return start;
  }
  return undefined;
}
