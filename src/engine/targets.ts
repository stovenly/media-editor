import type { MediaKind } from '../io/formats';

export type TargetGroup = 'image' | 'animated' | 'icon' | 'video' | 'audio';

export type Target = {
  id: string;
  group: TargetGroup;
  label: string;
  ext: string;
  mime: string;
  alpha: boolean;
  from: readonly MediaKind[];
  hint?: string;
  requires?: 'animated' | 'motion';
};

export type Facts = { animated?: boolean; motion?: boolean };

const IMAGE: readonly MediaKind[] = ['image'];
const VISUAL: readonly MediaKind[] = ['image', 'video'];
const AV: readonly MediaKind[] = ['audio', 'video'];

export const TARGETS: readonly Target[] = [
  {
    id: 'jpeg',
    group: 'image',
    label: 'JPG',
    ext: 'jpg',
    mime: 'image/jpeg',
    alpha: false,
    from: IMAGE,
    hint: 'Works everywhere',
  },
  {
    id: 'png',
    group: 'image',
    label: 'PNG',
    ext: 'png',
    mime: 'image/png',
    alpha: true,
    from: IMAGE,
    hint: 'Lossless, keeps transparency',
  },
  {
    id: 'webp',
    group: 'image',
    label: 'WebP',
    ext: 'webp',
    mime: 'image/webp',
    alpha: true,
    from: IMAGE,
    hint: 'Small, for the web',
  },
  {
    id: 'avif',
    group: 'image',
    label: 'AVIF',
    ext: 'avif',
    mime: 'image/avif',
    alpha: true,
    from: IMAGE,
    hint: 'Smallest, newer browsers',
  },
  {
    id: 'jxl',
    group: 'image',
    label: 'JPEG XL',
    ext: 'jxl',
    mime: 'image/jxl',
    alpha: true,
    from: IMAGE,
    hint: 'Not supported in most browsers',
  },
  {
    id: 'gif',
    group: 'image',
    label: 'GIF',
    ext: 'gif',
    mime: 'image/gif',
    alpha: true,
    from: IMAGE,
  },
  {
    id: 'tiff',
    group: 'image',
    label: 'TIFF',
    ext: 'tif',
    mime: 'image/tiff',
    alpha: true,
    from: IMAGE,
    hint: 'For print and archiving',
  },
  {
    id: 'bmp',
    group: 'image',
    label: 'BMP',
    ext: 'bmp',
    mime: 'image/bmp',
    alpha: false,
    from: IMAGE,
  },
  {
    id: 'tga',
    group: 'image',
    label: 'TGA',
    ext: 'tga',
    mime: 'image/x-tga',
    alpha: true,
    from: IMAGE,
  },
  {
    id: 'qoi',
    group: 'image',
    label: 'QOI',
    ext: 'qoi',
    mime: 'image/qoi',
    alpha: true,
    from: IMAGE,
  },
  {
    id: 'ppm',
    group: 'image',
    label: 'PPM',
    ext: 'ppm',
    mime: 'image/x-portable-pixmap',
    alpha: false,
    from: IMAGE,
  },
  {
    id: 'jp2',
    group: 'image',
    label: 'JPEG 2000',
    ext: 'jp2',
    mime: 'image/jp2',
    alpha: true,
    from: IMAGE,
  },
  {
    id: 'frames',
    group: 'image',
    label: 'Frames (ZIP)',
    ext: 'zip',
    mime: 'application/zip',
    alpha: true,
    from: VISUAL,
    hint: 'One PNG per frame',
    requires: 'animated',
  },
  {
    id: 'contact-sheet',
    group: 'image',
    label: 'Contact sheet',
    ext: 'jpg',
    mime: 'image/jpeg',
    alpha: false,
    from: ['video'],
    hint: 'A grid of 16 thumbnails',
  },
  {
    id: 'pdf',
    group: 'image',
    label: 'PDF',
    ext: 'pdf',
    mime: 'application/pdf',
    alpha: false,
    from: IMAGE,
    hint: 'One image per page',
  },

  {
    id: 'gif-anim',
    group: 'animated',
    label: 'Animated GIF',
    ext: 'gif',
    mime: 'image/gif',
    alpha: true,
    from: VISUAL,
    hint: 'Plays everywhere, large files',
  },
  {
    id: 'webp-anim',
    group: 'animated',
    label: 'Animated WebP',
    ext: 'webp',
    mime: 'image/webp',
    alpha: true,
    from: VISUAL,
    hint: 'Much smaller than GIF',
  },
  {
    id: 'apng',
    group: 'animated',
    label: 'Animated PNG',
    ext: 'png',
    mime: 'image/apng',
    alpha: true,
    from: VISUAL,
    hint: 'Full colour, large files',
  },

  {
    id: 'favicon',
    group: 'icon',
    label: 'Favicon pack',
    ext: 'zip',
    mime: 'application/zip',
    alpha: true,
    from: IMAGE,
    hint: 'Every size a website needs',
  },
  {
    id: 'ico',
    group: 'icon',
    label: 'Windows icon (ICO)',
    ext: 'ico',
    mime: 'image/x-icon',
    alpha: true,
    from: IMAGE,
  },
  {
    id: 'icns',
    group: 'icon',
    label: 'macOS icon (ICNS)',
    ext: 'icns',
    mime: 'image/icns',
    alpha: true,
    from: IMAGE,
  },
  {
    id: 'cur',
    group: 'icon',
    label: 'Cursor (CUR)',
    ext: 'cur',
    mime: 'image/x-icon',
    alpha: true,
    from: IMAGE,
  },

  {
    id: 'motion',
    group: 'video',
    label: 'Motion Photo clip',
    ext: 'mp4',
    mime: 'video/mp4',
    alpha: false,
    from: ['image'],
    hint: 'The video inside the photo',
    requires: 'motion',
  },
  {
    id: 'mp4',
    group: 'video',
    label: 'MP4',
    ext: 'mp4',
    mime: 'video/mp4',
    alpha: false,
    from: ['video'],
    hint: 'Works everywhere',
  },
  {
    id: 'webm',
    group: 'video',
    label: 'WebM',
    ext: 'webm',
    mime: 'video/webm',
    alpha: true,
    from: ['video'],
    hint: 'For the web',
  },
  {
    id: 'mov',
    group: 'video',
    label: 'MOV',
    ext: 'mov',
    mime: 'video/quicktime',
    alpha: false,
    from: ['video'],
    hint: 'For Apple apps',
  },
  {
    id: 'mkv',
    group: 'video',
    label: 'MKV',
    ext: 'mkv',
    mime: 'video/x-matroska',
    alpha: false,
    from: ['video'],
  },
  {
    id: 'avi',
    group: 'video',
    label: 'AVI',
    ext: 'avi',
    mime: 'video/x-msvideo',
    alpha: false,
    from: ['video'],
    hint: 'For older players',
  },
  {
    id: 'mpg',
    group: 'video',
    label: 'MPEG-2 (DVD)',
    ext: 'mpg',
    mime: 'video/mpeg',
    alpha: false,
    from: ['video'],
  },
  {
    id: '3gp',
    group: 'video',
    label: '3GP',
    ext: '3gp',
    mime: 'video/3gpp',
    alpha: false,
    from: ['video'],
    hint: 'For old phones',
  },
  {
    id: 'ogv',
    group: 'video',
    label: 'Ogg video',
    ext: 'ogv',
    mime: 'video/ogg',
    alpha: false,
    from: ['video'],
  },
  {
    id: 'ffv1',
    group: 'video',
    label: 'Lossless archive (FFV1)',
    ext: 'mkv',
    mime: 'video/x-matroska',
    alpha: true,
    from: ['video'],
  },

  {
    id: 'mp3',
    group: 'audio',
    label: 'MP3',
    ext: 'mp3',
    mime: 'audio/mpeg',
    alpha: false,
    from: AV,
    hint: 'Works everywhere',
  },
  {
    id: 'm4a',
    group: 'audio',
    label: 'M4A (AAC)',
    ext: 'm4a',
    mime: 'audio/mp4',
    alpha: false,
    from: AV,
    hint: 'Smaller than MP3',
  },
  {
    id: 'wav',
    group: 'audio',
    label: 'WAV',
    ext: 'wav',
    mime: 'audio/wav',
    alpha: false,
    from: AV,
    hint: 'Uncompressed',
  },
  {
    id: 'flac',
    group: 'audio',
    label: 'FLAC',
    ext: 'flac',
    mime: 'audio/flac',
    alpha: false,
    from: AV,
    hint: 'Lossless',
  },
  {
    id: 'opus',
    group: 'audio',
    label: 'Opus',
    ext: 'opus',
    mime: 'audio/ogg',
    alpha: false,
    from: AV,
    hint: 'Best for voice',
  },
  {
    id: 'ogg',
    group: 'audio',
    label: 'Ogg Vorbis',
    ext: 'ogg',
    mime: 'audio/ogg',
    alpha: false,
    from: AV,
  },
  {
    id: 'm4r',
    group: 'audio',
    label: 'iPhone ringtone',
    ext: 'm4r',
    mime: 'audio/mp4',
    alpha: false,
    from: AV,
    hint: 'Up to 40 seconds',
  },
  {
    id: 'm4b',
    group: 'audio',
    label: 'Audiobook (M4B)',
    ext: 'm4b',
    mime: 'audio/mp4',
    alpha: false,
    from: AV,
  },
  {
    id: 'alac',
    group: 'audio',
    label: 'Apple Lossless',
    ext: 'm4a',
    mime: 'audio/mp4',
    alpha: false,
    from: AV,
  },
  {
    id: 'aiff',
    group: 'audio',
    label: 'AIFF',
    ext: 'aiff',
    mime: 'audio/aiff',
    alpha: false,
    from: AV,
  },
  {
    id: 'caf',
    group: 'audio',
    label: 'CAF',
    ext: 'caf',
    mime: 'audio/x-caf',
    alpha: false,
    from: AV,
  },
  {
    id: 'wv',
    group: 'audio',
    label: 'WavPack',
    ext: 'wv',
    mime: 'audio/wavpack',
    alpha: false,
    from: AV,
  },
  {
    id: 'ac3',
    group: 'audio',
    label: 'AC-3',
    ext: 'ac3',
    mime: 'audio/ac3',
    alpha: false,
    from: AV,
  },
  { id: 'au', group: 'audio', label: 'AU', ext: 'au', mime: 'audio/basic', alpha: false, from: AV },
];

export const GROUP_LABELS: Record<TargetGroup, string> = {
  image: 'Image',
  animated: 'Animated',
  icon: 'Icon',
  video: 'Video',
  audio: 'Audio',
};

const BY_ID = new Map(TARGETS.map((target) => [target.id, target]));

export function target(id: string): Target {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown output ${id}`);
  return found;
}

const SUGGESTIONS: Record<string, readonly string[]> = {
  heic: ['jpeg', 'png', 'webp'],
  png: ['jpeg', 'webp', 'avif', 'favicon'],
  svg: ['png', 'favicon', 'ico'],
  gif: ['mp4', 'webp-anim', 'png'],
  apng: ['gif-anim', 'webp-anim', 'png'],
  webp: ['jpeg', 'png', 'gif-anim'],
  avif: ['jpeg', 'png', 'webp'],
  jxl: ['jpeg', 'png', 'webp'],
  ico: ['png', 'ico'],
  icns: ['png', 'ico'],
  psd: ['png', 'jpeg', 'tiff'],
  tiff: ['jpeg', 'png', 'pdf'],
  wav: ['mp3', 'm4a', 'flac'],
  flac: ['mp3', 'm4a', 'wav'],
  aiff: ['mp3', 'wav', 'flac'],
  mov: ['mp4', 'gif-anim', 'mp3'],
  mkv: ['mp4', 'webm', 'mp3'],
  webm: ['mp4', 'gif-anim', 'mp3'],
  avi: ['mp4', 'webm', 'mp3'],
  wmv: ['mp4', 'webm', 'mp3'],
};

const BY_KIND: Record<MediaKind, readonly string[]> = {
  image: ['jpeg', 'png', 'webp', 'avif'],
  audio: ['mp3', 'm4a', 'wav', 'flac'],
  video: ['mp4', 'webm', 'gif-anim', 'mp3'],
};

export function suggestions(format: string, kind: MediaKind, facts: Facts = {}): Target[] {
  const ids = SUGGESTIONS[format] ?? (RAW.has(format) ? ['jpeg', 'tiff', 'png'] : BY_KIND[kind]);
  const list = ids.filter((id) => id !== format).map(target);
  return facts.motion ? [target('motion'), ...list.slice(0, 3)] : list;
}

export function targetsFor(kind: MediaKind, facts: Facts = {}): Target[] {
  return TARGETS.filter(
    (t) =>
      t.from.includes(kind) &&
      (!t.requires || (kind === 'video' && t.requires === 'animated') || facts[t.requires]),
  );
}

export const RAW = new Set(['dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf', 'pef', 'srw']);
