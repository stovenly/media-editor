// The image edit model. Applied in a fixed order: orient, free rotate, crop, redact, adjust, resize, pad.
export type Rect = { x: number; y: number; width: number; height: number }; // 0..1 fractions

export type Redaction = {
  id: string;
  rect: Rect;
  kind: 'fill' | 'blur' | 'pixelate';
  color: string;
};

export type Adjustments = {
  exposure: number; // stops, -3..3
  brightness: number; // -100..100
  contrast: number; // -100..100
  saturation: number; // -100..100
  temperature: number; // -100..100, warmer is positive
  tint: number; // -100..100, magenta is positive
};

export type ImageEdit = {
  rotate: 0 | 90 | 180 | 270; // clockwise
  flipH: boolean;
  flipV: boolean;
  angle: number; // degrees, -45..45, clockwise; the result is cropped to the largest upright rectangle
  crop: Rect | null; // fractions of the image after rotation
  redactions: Redaction[]; // fractions of the image after cropping
  adjust: Adjustments;
  resize: { width: number; height: number } | null; // pixels
  pad: { top: number; right: number; bottom: number; left: number; color: string } | null; // pixels
};

export const NO_ADJUSTMENTS: Adjustments = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
};

export const EMPTY_EDIT: ImageEdit = {
  rotate: 0,
  flipH: false,
  flipV: false,
  angle: 0,
  crop: null,
  redactions: [],
  adjust: NO_ADJUSTMENTS,
  resize: null,
  pad: null,
};

export function isEmptyEdit(edit: ImageEdit | null | undefined): boolean {
  return !edit || JSON.stringify(edit) === JSON.stringify(EMPTY_EDIT);
}

export function hasAdjustments(adjust: Adjustments): boolean {
  return Object.values(adjust).some((value) => value !== 0);
}

export type Size = { width: number; height: number };

export function orientedSize(size: Size, rotate: ImageEdit['rotate']): Size {
  return rotate === 90 || rotate === 270 ? { width: size.height, height: size.width } : size;
}

// Largest upright rectangle inside a w×h image rotated by `degrees`, keeping the image's aspect ratio.
export function inscribedSize(size: Size, degrees: number): Size {
  const { width: w, height: h } = size;
  if (degrees === 0 || w <= 0 || h <= 0) return size;
  const angle = (Math.abs(degrees) * Math.PI) / 180;
  const sin = Math.abs(Math.sin(angle));
  const cos = Math.abs(Math.cos(angle));
  const longer = Math.max(w, h);
  const shorter = Math.min(w, h);
  if (shorter <= 2 * sin * cos * longer || Math.abs(sin - cos) < 1e-10) {
    const x = 0.5 * shorter;
    return w >= h ? { width: x / sin, height: x / cos } : { width: x / cos, height: x / sin };
  }
  const cos2 = cos * cos - sin * sin;
  return { width: (w * cos - h * sin) / cos2, height: (h * cos - w * sin) / cos2 };
}

// Pixel size after orientation, rotation and crop, before resize and padding.
export function croppedSize(source: Size, edit: ImageEdit): Size {
  const oriented = orientedSize(source, edit.rotate);
  const rotated = inscribedSize(oriented, edit.angle);
  const crop = edit.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  return {
    width: Math.max(1, Math.round(rotated.width * crop.width)),
    height: Math.max(1, Math.round(rotated.height * crop.height)),
  };
}

export function finalSize(source: Size, edit: ImageEdit): Size {
  const base = edit.resize ?? croppedSize(source, edit);
  const pad = edit.pad;
  return pad
    ? { width: base.width + pad.left + pad.right, height: base.height + pad.top + pad.bottom }
    : base;
}

export function clampRect(rect: Rect): Rect {
  const x = Math.min(1, Math.max(0, rect.x));
  const y = Math.min(1, Math.max(0, rect.y));
  return {
    x,
    y,
    width: Math.max(0.001, Math.min(1 - x, rect.width)),
    height: Math.max(0.001, Math.min(1 - y, rect.height)),
  };
}

// A crop rectangle of the given aspect ratio (width / height of the image in pixels), centred and as large as fits.
export function aspectCrop(size: Size, aspect: number): Rect {
  const imageAspect = size.width / size.height;
  if (aspect > imageAspect) {
    const height = imageAspect / aspect;
    return { x: 0, y: (1 - height) / 2, width: 1, height };
  }
  const width = aspect / imageAspect;
  return { x: (1 - width) / 2, y: 0, width, height: 1 };
}
