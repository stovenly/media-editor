// Shared vips helpers for the image engine and the image editor. Runs in workers.
import type { Vips } from './engines';

export type VImage = InstanceType<Vips['Image']>;

// Deletes every image it tracked, except ones marked as kept (owned by someone else).
export class Scope {
  private images: VImage[] = [];
  private kept = new Set<VImage>();
  track<T extends VImage>(image: T): T {
    this.images.push(image);
    return image;
  }
  keep(image: VImage): void {
    this.kept.add(image);
  }
  dispose(): void {
    for (const image of this.images) {
      if (this.kept.has(image)) continue;
      try {
        image.delete();
      } catch {
        // Already deleted.
      }
    }
    this.images = [];
  }
}

export function pageHeight(image: VImage): number {
  return image.pageHeight || image.height;
}

export function rgbaOf(image: VImage, temporary: VImage[]): VImage {
  let out = image;
  if (out.format !== 'uchar') temporary.push((out = out.cast('uchar')));
  if (out.bands < 3) temporary.push((out = out.colourspace('srgb')));
  if (!out.hasAlpha()) temporary.push((out = out.bandjoin(255)));
  return out;
}

export function rgb(hex: string): number[] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function hasTransparency(image: VImage): boolean {
  const alpha = image.extractBand(image.bands - 1);
  const max = image.format === 'uchar' ? 255 : image.format === 'ushort' ? 65535 : 1;
  const transparent = alpha.min() < max;
  alpha.delete();
  return transparent;
}

// Resizes on premultiplied pixels so transparent edges don't darken. Keeps every animation frame.
export function resize(vips: Vips, scope: Scope, image: VImage, maxEdge: number): VImage {
  const frameHeight = image.pageHeight || image.height;
  const pages = Math.max(1, Math.round(image.height / frameHeight));
  const scale = maxEdge / Math.max(image.width, frameHeight);
  if (scale >= 1) return image;
  const newWidth = Math.max(1, Math.round(image.width * scale));
  const newFrame = Math.max(1, Math.round(frameHeight * scale));
  const alpha = image.hasAlpha();
  const format = image.format;
  let work = alpha ? scope.track(image.premultiply()) : image;
  work = scope.track(
    work.resize(newWidth / image.width, {
      vscale: (newFrame * pages) / image.height,
      kernel: 'lanczos3',
    }),
  );
  if (alpha) work = scope.track(scope.track(work.unpremultiply()).cast(format));
  if (pages > 1) {
    const copy = scope.track(work.copy());
    copy.setInt('page-height', newFrame);
    return copy;
  }
  return work;
}

export function toSrgbAlpha(scope: Scope, image: VImage): VImage {
  let out = image;
  if (out.format !== 'uchar')
    out = scope.track(out.colourspace(out.bands <= 2 ? 'b-w' : 'srgb').cast('uchar'));
  if (out.bands < 3) out = scope.track(out.colourspace('srgb'));
  if (!out.hasAlpha()) out = scope.track(out.bandjoin(255));
  return out;
}

export function squareUp(_vips: Vips, scope: Scope, image: VImage): VImage {
  const side = Math.max(image.width, image.height);
  if (image.width === image.height) return image;
  return scope.track(
    image.embed((side - image.width) >> 1, (side - image.height) >> 1, side, side, {
      extend: 'background',
      background: [0, 0, 0, 0],
    }),
  );
}
