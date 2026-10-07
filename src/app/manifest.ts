// The web app manifest, built from the format table so "Open with" lists exactly what the converter reads.
import { FORMATS, type MediaKind } from '../io/formats';

// Format ids whose usual file extensions differ from the id.
const EXTENSIONS: Record<string, string[]> = {
  jpeg: ['jpg', 'jpeg', 'jfif'],
  tiff: ['tif', 'tiff'],
  pnm: ['pnm', 'ppm', 'pgm', 'pbm', 'pam'],
  sun: ['ras'],
  fits: ['fits', 'fit'],
  heic: ['heic', 'heif'],
  jp2: ['jp2', 'j2k', 'jpx'],
  mts: ['mts', 'm2ts', 'ts'],
  mpg: ['mpg', 'mpeg'],
  aiff: ['aiff', 'aif'],
  ogg: ['ogg', 'oga'],
  ass: ['ass', 'ssa'],
  apng: [],
};

const MIME_GROUP: Record<MediaKind, string> = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
  subtitle: 'text/plain',
};

export function webManifest(): string {
  const accept: Record<string, string[]> = {};
  for (const [id, info] of Object.entries(FORMATS)) {
    const list = (accept[MIME_GROUP[info.kind]] ??= []);
    for (const ext of EXTENSIONS[id] ?? [id]) if (!list.includes(`.${ext}`)) list.push(`.${ext}`);
  }
  return JSON.stringify(
    {
      name: 'Media Editor',
      short_name: 'Media Editor',
      description: 'Convert and edit images, audio and video. Files never leave your device.',
      id: './',
      start_url: './',
      scope: './',
      display: 'standalone',
      background_color: '#0f0f12',
      theme_color: '#4f46e5',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
      file_handlers: [{ action: './', accept }],
      share_target: {
        action: './share',
        method: 'POST',
        enctype: 'multipart/form-data',
        params: {
          files: [
            { name: 'files', accept: [...Object.keys(accept), ...Object.values(accept).flat()] },
          ],
        },
      },
      launch_handler: { client_mode: 'focus-existing' },
    },
    null,
    2,
  );
}
