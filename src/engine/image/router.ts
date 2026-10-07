import { target, type Target } from '../targets';

export type ImageEngine = 'vips' | 'magick' | 'icns' | 'apng';
export type ImageEncoder =
  'vips' | 'magick' | 'ico' | 'cur' | 'icns' | 'favicon' | 'apng' | 'frames';

export type ImagePlan = {
  decoder: ImageEngine;
  encoder: ImageEncoder;
  animated: boolean;
  flatten: boolean;
  toSrgb: boolean;
};

// wasm-vips in this build reads AVIF but not HEVC-coded HEIC.
const VIPS_DECODES = new Set([
  'jpeg',
  'png',
  'gif',
  'webp',
  'avif',
  'jxl',
  'tiff',
  'svg',
  'pnm',
  'hdr',
]);
const VIPS_ENCODES = new Set([
  'jpeg',
  'png',
  'webp',
  'avif',
  'jxl',
  'gif',
  'tiff',
  'ppm',
  'gif-anim',
  'webp-anim',
]);
const OWN_ENCODERS: Record<string, ImageEncoder> = {
  apng: 'apng',
  frames: 'frames',
  ico: 'ico',
  cur: 'cur',
  icns: 'icns',
  favicon: 'favicon',
};
// Formats that cannot embed a colour profile, so pixels are converted to sRGB first.
const NO_PROFILE = new Set([
  'bmp',
  'gif',
  'gif-anim',
  'ico',
  'cur',
  'icns',
  'favicon',
  'qoi',
  'tga',
  'ppm',
  'pdf',
  'jp2',
]);

export type ImageInput = { format: string; pages: number };

export function planImage(input: ImageInput, targetId: string): ImagePlan {
  const out: Target = target(targetId);
  const animated = (out.group === 'animated' || targetId === 'frames') && input.pages > 1;
  const decoder: ImageEngine =
    input.format === 'icns'
      ? 'icns'
      : input.format === 'apng'
        ? animated
          ? 'apng'
          : 'vips'
        : VIPS_DECODES.has(input.format)
          ? 'vips'
          : 'magick';
  const encoder: ImageEncoder =
    OWN_ENCODERS[targetId] ?? (VIPS_ENCODES.has(targetId) ? 'vips' : 'magick');
  return {
    decoder,
    encoder,
    animated,
    flatten: !out.alpha,
    toSrgb: NO_PROFILE.has(targetId),
  };
}
