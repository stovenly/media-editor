// Applies an ImageEdit with vips. `scale` maps source pixels to the image being edited (below 1 for previews).
import { hasAdjustments, inscribedSize, type ImageEdit, type Rect } from '../../project/image-edit';
import type { Vips } from './engines';
import { rgb, Scope, type VImage } from './vips-util';

const ROT = { 90: 'd90', 180: 'd180', 270: 'd270' } as const;

export function applyEdit(
  vips: Vips,
  scope: Scope,
  source: VImage,
  edit: ImageEdit,
  scale: number,
): VImage {
  let image = source;
  const step = (next: VImage) => (image = scope.track(next));

  if (edit.rotate !== 0) step(image.rot(ROT[edit.rotate]));
  if (edit.flipH) step(image.flip('horizontal'));
  if (edit.flipV) step(image.flip('vertical'));

  if (edit.angle !== 0) {
    const before = { width: image.width, height: image.height };
    const alpha = image.hasAlpha();
    const format = image.format;
    if (alpha) step(image.premultiply());
    step(
      image.similarity({ angle: edit.angle, interpolate: vips.Interpolate.newFromName('bicubic') }),
    );
    if (alpha) step(image.unpremultiply().cast(format));
    const inner = inscribedSize(before, edit.angle);
    const width = Math.max(1, Math.floor(inner.width));
    const height = Math.max(1, Math.floor(inner.height));
    step(
      image.crop(
        Math.floor((image.width - width) / 2),
        Math.floor((image.height - height) / 2),
        width,
        height,
      ),
    );
  }

  if (edit.crop) step(cropTo(image, edit.crop));

  for (const redaction of edit.redactions)
    step(redact(vips, scope, image, redaction.rect, redaction.kind, redaction.color));

  if (hasAdjustments(edit.adjust)) step(adjust(scope, image, edit.adjust));

  if (edit.resize) {
    const width = Math.max(1, Math.round(edit.resize.width * scale));
    const height = Math.max(1, Math.round(edit.resize.height * scale));
    if (width !== image.width || height !== image.height) {
      const alpha = image.hasAlpha();
      const format = image.format;
      let work = alpha ? scope.track(image.premultiply()) : image;
      work = scope.track(
        work.resize(width / work.width, { vscale: height / work.height, kernel: 'lanczos3' }),
      );
      step(alpha ? work.unpremultiply().cast(format) : work);
    }
  }

  if (edit.pad) {
    const { top, right, bottom, left, color } = edit.pad;
    const [t, r, b, l] = [top, right, bottom, left].map((px) => Math.round(px * scale)) as [
      number,
      number,
      number,
      number,
    ];
    if (t || r || b || l) {
      const fill =
        image.hasAlpha() && color === 'transparent'
          ? [0, 0, 0, 0]
          : [...rgb(color === 'transparent' ? '#ffffff' : color), 255].slice(0, image.bands);
      step(
        image.embed(l, t, image.width + l + r, image.height + t + b, {
          extend: 'background',
          background: fill,
        }),
      );
    }
  }
  return image;
}

function pixels(image: VImage, rect: Rect) {
  const x = Math.min(image.width - 1, Math.max(0, Math.round(rect.x * image.width)));
  const y = Math.min(image.height - 1, Math.max(0, Math.round(rect.y * image.height)));
  const width = Math.max(1, Math.min(image.width - x, Math.round(rect.width * image.width)));
  const height = Math.max(1, Math.min(image.height - y, Math.round(rect.height * image.height)));
  return { x, y, width, height };
}

function cropTo(image: VImage, rect: Rect): VImage {
  const { x, y, width, height } = pixels(image, rect);
  return image.crop(x, y, width, height);
}

// Solid fill is a real redaction. Blur and pixelate are cosmetic and can be partly reversed.
function redact(
  vips: Vips,
  scope: Scope,
  image: VImage,
  rect: Rect,
  kind: 'fill' | 'blur' | 'pixelate',
  color: string,
): VImage {
  const { x, y, width, height } = pixels(image, rect);
  let patch: VImage;
  if (kind === 'fill') {
    const ink = [...rgb(color), 255, 255].slice(0, image.bands);
    const black = scope.track(vips.Image.black(width, height, { bands: image.bands }));
    patch = scope.track(
      black.linear(0, ink).cast(image.format).copy({ interpretation: image.interpretation }),
    );
  } else {
    const region = scope.track(image.crop(x, y, width, height));
    if (kind === 'blur') {
      patch = scope.track(
        region.gaussblur(Math.max(3, Math.min(width, height) / 6)).cast(image.format),
      );
    } else {
      const block = Math.max(4, Math.round(Math.min(width, height) / 8));
      const small = scope.track(region.resize(1 / block, { kernel: 'nearest' }));
      const big = scope.track(
        small.resize(width / small.width, { vscale: height / small.height, kernel: 'nearest' }),
      );
      patch = scope.track(big.crop(0, 0, Math.min(width, big.width), Math.min(height, big.height)));
    }
  }
  return image.insert(patch, x, y);
}

function adjust(scope: Scope, image: VImage, a: ImageEdit['adjust']): VImage {
  const alpha = image.hasAlpha() ? scope.track(image.extractBand(image.bands - 1)) : null;
  let colour = alpha ? scope.track(image.extractBand(0, { n: image.bands - 1 })) : image;
  const sixteen = image.format === 'ushort';

  colour = scope.track(colour.colourspace('scrgb'));
  const gain = 2 ** a.exposure;
  const warm = a.temperature / 100;
  const tint = a.tint / 100;
  if (gain !== 1 || warm !== 0 || tint !== 0) {
    colour = scope.track(
      colour.linear(
        [gain * (1 + 0.25 * warm), gain * (1 - 0.15 * tint), gain * (1 - 0.25 * warm)],
        [0, 0, 0],
      ),
    );
  }
  if (a.brightness !== 0 || a.contrast !== 0 || a.saturation !== 0) {
    const lch = scope.track(colour.colourspace('lch'));
    const k = 1 + a.contrast / 100;
    const s = Math.max(0, 1 + a.saturation / 100);
    colour = scope.track(lch.linear([k, s, 1], [50 * (1 - k) + a.brightness * 0.4, 0, 0]));
  }
  colour = scope.track(colour.colourspace(sixteen ? 'rgb16' : 'srgb'));
  colour = scope.track(colour.cast(sixteen ? 'ushort' : 'uchar'));
  return alpha ? colour.bandjoin(alpha.cast(colour.format)) : colour;
}
