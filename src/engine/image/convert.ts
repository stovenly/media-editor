// Image conversion inside an image worker: decode, normalise, encode, strip, and fit to a size.
import { stripImage } from '../../metadata/strip';
import { RAW, target } from '../targets';
import { isEmptyEdit } from '../../project/image-edit';
import { applyEdit } from './edit';
import type { Magick, Vips } from './engines';
import {
  hasTransparency,
  pageHeight,
  resize,
  rgb,
  rgbaOf,
  Scope,
  squareUp,
  toSrgbAlpha,
  type VImage,
} from './vips-util';
import { assembleApng, splitApng } from './apng';
import { largestIcnsImage, writeIcns, writeIco, ICNS_TYPES, type IconEntry } from './icons';
import { planImage, type ImagePlan } from './router';
import type { ImageResult, ImageSettings } from './settings';

export type Engines = { vips(): Promise<Vips>; magick(): Promise<Magick> };

export type ConvertInput = {
  bytes: Uint8Array;
  format: string;
  pages: number;
  engines: Engines;
  onProgress: (fraction: number) => void;
};

// Signatureless or TIFF-based formats that ImageMagick would otherwise misread.
const MAGICK_HINTS = new Set([
  'tga',
  'wbmp',
  'pcx',
  'sun',
  'xbm',
  'xpm',
  'sgi',
  'dds',
  'fits',
  'qoi',
  'psd',
  'exr',
  'hdr',
  'bmp',
  'ico',
  'cur',
  'heic',
  'pnm',
  ...RAW,
]);

const LOSSY = new Set(['jpeg', 'webp', 'avif', 'jxl', 'webp-anim', 'jp2', 'heic']);

export async function convertImage(
  input: ConvertInput,
  requested: ImageSettings,
): Promise<ImageResult> {
  let settings = requested;
  const plan = planImage({ format: input.format, pages: input.pages }, settings.target);
  const needsMagick =
    plan.decoder === 'magick' || plan.encoder === 'magick' || plan.decoder === 'icns';
  const vips = await input.engines.vips();
  const magick = needsMagick ? await input.engines.magick() : undefined;
  input.onProgress(0.1);

  const scope = new Scope();
  try {
    const notes: string[] = [];
    let source = scope.track(await decode(vips, magick, input, plan, notes));
    const edit = settings.edit;
    if (edit && !isEmptyEdit(edit)) {
      if (plan.animated) {
        notes.push('Edits apply to still images only');
      } else {
        source = scope.track(applyEdit(vips, scope, source, edit, 1));
        if (edit.redactions.length) {
          settings = { ...settings, metadata: 'none' };
          notes.push('Redacted, with all metadata and thumbnails removed');
        }
      }
    }
    input.onProgress(0.3);

    if (
      plan.encoder === 'favicon' ||
      plan.encoder === 'ico' ||
      plan.encoder === 'cur' ||
      plan.encoder === 'icns'
    ) {
      const result = await encodeIcons(vips, scope, source, input, plan, settings);
      input.onProgress(1);
      return { ...result, notes };
    }

    if (plan.encoder === 'frames') {
      const bytes = await encodeFrames(
        scope,
        scope.track(prepare(vips, scope, source, plan, settings, notes)),
      );
      input.onProgress(1);
      return { bytes, width: source.width, height: pageHeight(source), quality: null, notes };
    }

    const prepared = scope.track(prepare(vips, scope, source, plan, settings, notes));
    return await finish(vips, magick, scope, prepared, plan, settings, notes, input.onProgress);
  } finally {
    scope.dispose();
  }
}

async function finish(
  vips: Vips,
  magick: Magick | undefined,
  scope: Scope,
  prepared: VImage,
  plan: ImagePlan,
  settings: ImageSettings,
  notes: string[],
  onProgress: (fraction: number) => void,
): Promise<ImageResult> {
  const encodeAt = (image: VImage, quality: number) =>
    encode(vips, magick, scope, image, plan, settings, quality);
  let bytes: Uint8Array;
  let quality: number | null =
    LOSSY.has(settings.target) && !settings.lossless ? settings.quality : null;
  let image = prepared;
  if (settings.targetBytes) {
    const fitted = await fitToSize(vips, scope, prepared, settings, encodeAt, onProgress);
    ({ bytes, image, quality } = fitted);
    if (fitted.over) notes.push("Couldn't get under the target size");
    if (image !== prepared) notes.push(`Scaled down to ${image.width}×${pageHeight(image)} to fit`);
  } else {
    bytes = await encodeAt(prepared, settings.quality);
  }
  onProgress(1);
  return { bytes, width: image.width, height: pageHeight(image), quality, notes };
}

export type Frame = { bytes: Uint8Array; format: string };

const ANIMATION_EDGE = 800;

// Several still images become one animation, each centred on a canvas the size of the first.
export async function animateImages(
  frames: readonly Frame[],
  delayMs: number,
  settings: ImageSettings,
  engines: Engines,
  onProgress: (fraction: number) => void,
): Promise<ImageResult> {
  const vips = await engines.vips();
  const plans = frames.map((frame) => planImage({ format: frame.format, pages: 1 }, 'png'));
  const magick = plans.some((plan) => plan.decoder !== 'vips') ? await engines.magick() : undefined;
  const scope = new Scope();
  try {
    const notes: string[] = [];
    const edge = settings.maxEdge ?? ANIMATION_EDGE;
    let width = 0;
    let height = 0;
    const pages: VImage[] = [];
    for (const [index, frame] of frames.entries()) {
      const input: ConvertInput = {
        bytes: frame.bytes,
        format: frame.format,
        pages: 1,
        engines,
        onProgress: () => {},
      };
      let image = scope.track(
        toSrgbAlpha(scope, scope.track(await decode(vips, magick, input, plans[index]!, []))),
      );
      if (index === 0) {
        const scale = Math.min(1, edge / Math.max(image.width, image.height));
        width = Math.max(2, Math.round((image.width * scale) / 2) * 2);
        height = Math.max(2, Math.round((image.height * scale) / 2) * 2);
      }
      const fit = Math.min(width / image.width, height / image.height);
      if (fit !== 1)
        image = scope.track(
          resize(vips, scope, image, Math.round(Math.max(image.width, image.height) * fit)),
        );
      const x = Math.floor((width - image.width) / 2);
      const y = Math.floor((height - image.height) / 2);
      pages.push(
        scope.track(
          image.embed(x, y, width, height, { extend: 'background', background: [0, 0, 0, 0] }),
        ),
      );
      onProgress(0.1 + (0.5 * (index + 1)) / frames.length);
    }
    const joined = scope.track(
      vips.Image.arrayjoin(pages, { across: 1 }).copy({ interpretation: 'srgb' }),
    );
    joined.setInt('page-height', height);
    joined.setArrayInt(
      'delay',
      frames.map(() => Math.round(delayMs)),
    );
    joined.setInt('loop', 0);
    const plan = planImage({ format: 'gif', pages: frames.length }, settings.target);
    const prepared = scope.track(
      prepare(vips, scope, joined, plan, { ...settings, maxEdge: null }, notes),
    );
    return await finish(vips, magick, scope, prepared, plan, settings, notes, onProgress);
  } finally {
    scope.dispose();
  }
}

export async function decode(
  vips: Vips,
  magick: Magick | undefined,
  input: ConvertInput,
  plan: ImagePlan,
  notes: string[],
): Promise<VImage> {
  if (plan.decoder === 'icns') {
    const entry = largestIcnsImage(input.bytes);
    if (!entry) throw new Error('This icon has no images this app can read');
    if (entry[0] === 0x89) return vips.Image.newFromBuffer(entry);
    if (!magick) throw new Error('The extra image formats engine was not loaded');
    return vips.Image.newFromBuffer(magickToTiff(magick, entry, undefined));
  }
  if (plan.decoder === 'apng') return decodeApng(vips, input.bytes);
  if (plan.decoder === 'vips') {
    let image = vips.Image.newFromBuffer(input.bytes, plan.animated ? 'n=-1' : '');
    if (!plan.animated && input.pages > 1) notes.push('Only the first frame was kept');
    if (image.coding === 'rad') {
      const unpacked = image.rad2float();
      image.delete();
      image = unpacked;
    }
    const rotated = image.autorot();
    image.delete();
    return rotated;
  }
  const hint = MAGICK_HINTS.has(input.format) ? input.format.toUpperCase() : undefined;
  if (input.format === 'exr' || input.format === 'hdr')
    notes.push('HDR was tone-mapped to standard range');
  return vips.Image.newFromBuffer(magickToTiff(magick!, input.bytes, hint));
}

// Composites APNG frames onto a full-size canvas and stacks them vertically, like vips's own animated loaders.
function decodeApng(vips: Vips, bytes: Uint8Array): VImage {
  const apng = splitApng(bytes);
  const blank = () =>
    vips.Image.black(apng.width, apng.height, { bands: 4 }).copy({ interpretation: 'srgb' });
  let canvas = blank();
  const pages: VImage[] = [];
  const temporary: VImage[] = [canvas];
  for (const frame of apng.frames) {
    const decoded = vips.Image.newFromBuffer(frame.png);
    const rgba = rgbaOf(decoded, temporary);
    const previous = canvas;
    canvas =
      frame.blend === 1
        ? canvas.composite2(rgba, 'over', { x: frame.x, y: frame.y }).cast('uchar')
        : canvas.insert(rgba, frame.x, frame.y);
    temporary.push(decoded, canvas);
    pages.push(canvas);
    if (frame.dispose === 1) {
      const clear = vips.Image.black(frame.width, frame.height, { bands: 4 });
      canvas = canvas.insert(clear, frame.x, frame.y);
      temporary.push(clear, canvas);
    } else if (frame.dispose === 2) {
      canvas = previous;
    }
  }
  const joined = vips.Image.arrayjoin(pages, { across: 1 }).copy({ interpretation: 'srgb' });
  joined.setInt('page-height', apng.height);
  joined.setArrayInt(
    'delay',
    apng.frames.map((frame) => frame.delayMs),
  );
  joined.setInt('loop', apng.loops);
  for (const image of temporary) image.delete();
  return joined;
}

// Decodes with ImageMagick, applies orientation once, and hands pixels to vips as uncompressed TIFF.
function magickToTiff(magick: Magick, bytes: Uint8Array, format: string | undefined): Uint8Array {
  const { ImageMagick, MagickFormat, MagickReadSettings } = magick;
  const settings = new MagickReadSettings(format ? { format: format as never } : {});
  return ImageMagick.read(bytes, settings, (image) => {
    image.autoOrient();
    image.settings.setDefine(MagickFormat.Tiff, 'compression', 'none');
    return image.write(MagickFormat.Tiff, (data) => data.slice());
  });
}

const EIGHT_BIT = new Set([
  'jpeg',
  'webp',
  'webp-anim',
  'gif',
  'gif-anim',
  'bmp',
  'ico',
  'cur',
  'icns',
  'favicon',
  'qoi',
  'tga',
  'pdf',
  'avif',
  'jp2',
]);

function prepare(
  vips: Vips,
  scope: Scope,
  source: VImage,
  plan: ImagePlan,
  settings: ImageSettings,
  notes: string[],
): VImage {
  let image = source;
  const step = (next: VImage) => (image = scope.track(next));

  if (image.format !== 'uchar' && EIGHT_BIT.has(settings.target)) {
    const grey = image.interpretation === 'grey16' || image.interpretation === 'b-w';
    step(image.colourspace(grey ? 'b-w' : 'srgb'));
    if (image.format !== 'uchar') step(image.cast('uchar'));
  }

  if (plan.toSrgb && image.getTypeof('icc-profile-data') !== 0) {
    try {
      step(image.iccTransform('srgb', { embedded: true }));
      notes.push('Colours converted to sRGB');
    } catch {
      // A broken profile: keep the pixels as they are.
    }
  } else if (!['srgb', 'b-w', 'rgb16', 'grey16'].includes(image.interpretation)) {
    step(image.colourspace('srgb'));
  }

  if (settings.maxEdge) step(resize(vips, scope, image, settings.maxEdge));

  if (image.hasAlpha()) {
    if (plan.flatten) {
      const transparent = hasTransparency(image);
      step(image.flatten({ background: rgb(settings.background) }));
      if (transparent) notes.push('Transparency was filled with the background colour');
    } else if (settings.target === 'gif' || settings.target === 'gif-anim') {
      step(thresholdAlpha(image, settings.gifThreshold));
    }
  }
  return image;
}

function thresholdAlpha(image: VImage, threshold: number): VImage {
  const bands = image.bands;
  const colour = image.extractBand(0, { n: bands - 1 });
  const alpha = image.extractBand(bands - 1);
  const cut = alpha.moreEq(threshold).ifthenelse(255, 0);
  const joined = colour.bandjoin(cut.cast('uchar'));
  colour.delete();
  alpha.delete();
  cut.delete();
  return joined;
}

const KEEP_ICC = 8;
const KEEP_GAINMAP = 32;
const KEEP_ALL = 63;

function keepFlag(settings: ImageSettings, hdr: boolean): number {
  const base =
    settings.metadata === 'all' ? KEEP_ALL : settings.metadata === 'technical' ? KEEP_ICC : 0;
  return hdr ? base | KEEP_GAINMAP : base;
}

// An Ultra HDR gain map survives only JPEG to JPEG at the original size.
function keepsHdr(image: VImage, settings: ImageSettings): boolean {
  return (
    settings.keepHdr &&
    settings.target === 'jpeg' &&
    !settings.maxEdge &&
    !settings.targetBytes &&
    (image.getTypeof('gainmap') !== 0 || image.getTypeof('gainmap-data') !== 0)
  );
}

async function encode(
  vips: Vips,
  magick: Magick | undefined,
  scope: Scope,
  image: VImage,
  plan: ImagePlan,
  settings: ImageSettings,
  quality: number,
): Promise<Uint8Array> {
  const hdr = keepsHdr(image, settings);
  const keep = keepFlag(settings, hdr);
  const Q = Math.round(quality);
  const out = target(settings.target);
  let bytes: Uint8Array;
  if (plan.encoder === 'apng') {
    bytes = encodeApng(scope, image);
  } else if (plan.encoder === 'magick') {
    bytes = magickEncode(magick!, vipsPng(image, 'all'), settings.target, Q, settings.lossless);
  } else {
    switch (settings.target) {
      case 'jpeg':
        bytes = image.jpegsaveBuffer({ Q, keep, optimize_coding: true });
        break;
      case 'png':
        bytes = image.pngsaveBuffer({ keep, compression: 6 });
        break;
      case 'webp':
      case 'webp-anim':
        bytes = image.webpsaveBuffer({ Q, keep, lossless: settings.lossless, effort: 4 });
        break;
      case 'avif':
        bytes = image.heifsaveBuffer({
          Q,
          keep,
          lossless: settings.lossless,
          compression: 'av1',
          effort: 3,
        });
        break;
      case 'jxl': {
        const srgb = image.bands < 3 ? scope.track(image.colourspace('srgb')) : image;
        bytes = srgb.jxlsaveBuffer({ Q, keep, lossless: settings.lossless, effort: 5 });
        break;
      }
      case 'gif':
      case 'gif-anim':
        bytes = image.gifsaveBuffer({ keep, effort: 7, dither: 1 });
        break;
      case 'tiff':
        bytes = image.tiffsaveBuffer({ keep, compression: 'deflate', predictor: 'horizontal' });
        break;
      case 'ppm': {
        const flat = image.hasAlpha()
          ? scope.track(image.flatten({ background: rgb(settings.background) }))
          : image;
        bytes = flat.writeToBuffer('.ppm');
        break;
      }
      default:
        throw new Error(`No encoder for ${out.label}`);
    }
  }
  if (settings.metadata === 'all' || hdr) return bytes;
  return stripImage(bytes, out.mime, { icc: settings.metadata === 'technical' });
}

function encodeApng(scope: Scope, image: VImage): Uint8Array {
  const frameHeight = pageHeight(image);
  const pages = Math.max(1, Math.round(image.height / frameHeight));
  const temporary: VImage[] = [];
  const rgba = rgbaOf(image, temporary);
  temporary.forEach((t) => scope.track(t));
  const delays = image.getTypeof('delay') !== 0 ? image.getArrayInt('delay') : [];
  const frames: Uint8Array[] = [];
  for (let page = 0; page < pages; page++) {
    const frame = scope.track(rgba.crop(0, page * frameHeight, rgba.width, frameHeight));
    frames.push(frame.pngsaveBuffer({ keep: 'none', compression: 6 }));
  }
  const loops = image.getTypeof('loop') !== 0 ? image.getInt('loop') : 0;
  return assembleApng(
    frames,
    frames.map((_, i) => delays[i] ?? 100),
    loops,
  );
}

async function encodeFrames(scope: Scope, image: VImage): Promise<Uint8Array> {
  const frameHeight = pageHeight(image);
  const pages = Math.max(1, Math.round(image.height / frameHeight));
  const digits = String(pages).length;
  const files = [];
  for (let page = 0; page < pages; page++) {
    const frame = scope.track(image.crop(0, page * frameHeight, image.width, frameHeight));
    files.push({
      name: `frame-${String(page + 1).padStart(digits, '0')}.png`,
      bytes: frame.pngsaveBuffer({ keep: 'none', compression: 6 }),
    });
  }
  const { makeZip } = await import('../../io/zip');
  return makeZip(files);
}

function vipsPng(image: VImage, keep: string): Uint8Array {
  return image.pngsaveBuffer({ keep, compression: 1 });
}

const MAGICK_OUT: Record<string, string> = {
  bmp: 'BMP',
  tga: 'TGA',
  qoi: 'QOI',
  jp2: 'JP2',
  pdf: 'PDF',
  apng: 'APNG',
  'gif-anim': 'GIF',
  'webp-anim': 'WEBP',
  gif: 'GIF',
  webp: 'WEBP',
  png: 'PNG',
  jpeg: 'JPEG',
};

function magickEncode(
  magick: Magick,
  png: Uint8Array,
  targetId: string,
  quality: number,
  lossless: boolean,
): Uint8Array {
  const { ImageMagick } = magick;
  const format = MAGICK_OUT[targetId];
  if (!format) throw new Error(`No encoder for ${target(targetId).label}`);
  return ImageMagick.read(png, (image) => {
    image.quality = lossless ? 100 : quality;
    if (targetId === 'bmp') image.hasAlpha = false;
    image.strip();
    return image.write(format as never, (data) => data.slice());
  });
}

type Fitted = { bytes: Uint8Array; image: VImage; quality: number | null; over: boolean };

// Binary search on quality, then scale down and search again; never returns more than the target without saying so.
async function fitToSize(
  vips: Vips,
  scope: Scope,
  prepared: VImage,
  settings: ImageSettings,
  encodeAt: (image: VImage, quality: number) => Promise<Uint8Array>,
  onProgress: (fraction: number) => void,
): Promise<Fitted> {
  const limit = settings.targetBytes!;
  const lossy = LOSSY.has(settings.target) && !settings.lossless;
  let image = prepared;
  let smallest: Fitted | null = null;
  for (let round = 0; round < 6; round++) {
    if (lossy) {
      let low = 5;
      let high = Math.min(95, Math.max(settings.quality, 5));
      let best: Fitted | null = null;
      const top = await encodeAt(image, high);
      if (top.length <= limit) return { bytes: top, image, quality: high, over: false };
      while (high - low > 2) {
        const mid = Math.round((low + high) / 2);
        const bytes = await encodeAt(image, mid);
        if (bytes.length <= limit) {
          best = { bytes, image, quality: mid, over: false };
          low = mid;
        } else high = mid;
        onProgress(0.5 + 0.08 * round);
      }
      if (best) return best;
      const floor = await encodeAt(image, 5);
      if (floor.length <= limit) return { bytes: floor, image, quality: 5, over: false };
      if (!smallest || floor.length < smallest.bytes.length)
        smallest = { bytes: floor, image, quality: 5, over: true };
    } else {
      const bytes = await encodeAt(image, settings.quality);
      if (bytes.length <= limit) return { bytes, image, quality: null, over: false };
      if (!smallest || bytes.length < smallest.bytes.length)
        smallest = { bytes, image, quality: null, over: true };
    }
    const frame = image.pageHeight || image.height;
    const edge = Math.max(image.width, frame);
    const ratio = smallest ? Math.sqrt(limit / smallest.bytes.length) * 0.92 : 0.7;
    const nextEdge = Math.floor(edge * Math.min(0.85, ratio));
    if (nextEdge < 16) break;
    image = resize(vips, scope, image, nextEdge);
    onProgress(0.5 + 0.08 * round);
  }
  return smallest!;
}

async function encodeIcons(
  vips: Vips,
  scope: Scope,
  source: VImage,
  input: ConvertInput,
  plan: ImagePlan,
  settings: ImageSettings,
): Promise<{ bytes: Uint8Array; width: number; height: number; quality: null }> {
  const fromSvg = input.format === 'svg';
  const square = scope.track(squareUp(vips, scope, toSrgbAlpha(scope, source)));
  const render = (size: number, padding = 0, background?: string): Uint8Array => {
    const inner = size - padding * 2;
    let image = fromSvg
      ? scope.track(
          squareUp(
            vips,
            scope,
            toSrgbAlpha(
              scope,
              scope.track(vips.Image.thumbnailBuffer(input.bytes, inner, { height: inner })),
            ),
          ),
        )
      : scope.track(resize(vips, scope, square, inner));
    if (image.width !== inner)
      image = scope.track(image.resize(inner / image.width, { kernel: 'lanczos3' }));
    if (padding)
      image = scope.track(
        image.embed(padding, padding, size, size, {
          extend: 'background',
          background: [0, 0, 0, 0],
        }),
      );
    if (background) image = scope.track(image.flatten({ background: rgb(background) }));
    return image.pngsaveBuffer({ keep: 'none', compression: 9 });
  };
  const entries = (sizes: readonly number[]): IconEntry[] =>
    sizes.map((size) => ({ size, png: render(size) }));

  if (plan.encoder === 'ico') {
    const bytes = writeIco(entries([16, 24, 32, 48, 64, 128, 256]));
    return { bytes, width: 256, height: 256, quality: null };
  }
  if (plan.encoder === 'cur') {
    const bytes = writeIco(entries([32, 48, 64]), settings.hotspot);
    return { bytes, width: 32, height: 32, quality: null };
  }
  if (plan.encoder === 'icns') {
    const sizes = [...new Set(ICNS_TYPES.map(([, size]) => size))];
    return { bytes: writeIcns(entries(sizes)), width: 1024, height: 1024, quality: null };
  }

  const { makeZip } = await import('../../io/zip');
  const files: { name: string; bytes: Uint8Array }[] = [
    { name: 'favicon.ico', bytes: writeIco(entries([16, 32, 48])) },
    { name: 'apple-touch-icon.png', bytes: render(180, 20, settings.maskableBackground) },
    { name: 'icon-192.png', bytes: render(192) },
    { name: 'icon-512.png', bytes: render(512) },
    { name: 'icon-maskable-512.png', bytes: render(512, 52, settings.maskableBackground) },
    {
      name: 'manifest.webmanifest',
      bytes: new TextEncoder().encode(MANIFEST(settings.maskableBackground)),
    },
    { name: 'head.html', bytes: new TextEncoder().encode(HEAD(fromSvg)) },
  ];
  if (fromSvg) files.push({ name: 'icon.svg', bytes: input.bytes });
  return { bytes: await makeZip(files), width: 512, height: 512, quality: null };
}

const MANIFEST = (background: string) =>
  JSON.stringify(
    {
      icons: [
        { src: '/icon-192.png', type: 'image/png', sizes: '192x192' },
        { src: '/icon-512.png', type: 'image/png', sizes: '512x512' },
        { src: '/icon-maskable-512.png', type: 'image/png', sizes: '512x512', purpose: 'maskable' },
      ],
      background_color: background,
    },
    null,
    2,
  ) + '\n';

const HEAD = (svg: boolean) =>
  [
    '<link rel="icon" href="/favicon.ico" sizes="32x32">',
    ...(svg ? ['<link rel="icon" href="/icon.svg" type="image/svg+xml">'] : []),
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/manifest.webmanifest">',
    '',
  ].join('\n');
