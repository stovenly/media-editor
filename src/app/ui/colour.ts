// Hex and HSV conversions for ColourField. Hex is lowercase `#rrggbb`, or `#rrggbbaa` with alpha.

export type Hsv = { h: number; s: number; v: number }; // h 0..360, s and v 0..1

// Accepts `#rgb`, `#rrggbb` and, with `alpha`, `#rrggbbaa`, with or without the `#`.
export function parseHex(text: string, alpha = false): string | null {
  let hex = text.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(hex)) hex = [...hex].map((c) => c + c).join('');
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
  if (alpha && /^[0-9a-f]{8}$/.test(hex)) return `#${hex}`;
  return null;
}

export function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

// 0..1; a hex without an alpha pair is opaque.
export const alphaOf = (hex: string) =>
  hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;

export const withAlpha = (hex: string, alpha: number) =>
  `${hex.slice(0, 7)}${Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')}`;

export function hsvOf(hex: string): Hsv {
  const [r, g, b] = rgbOf(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: h * 60, s: max ? d / max : 0, v: max };
}

export function hsvHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return rgbHex(f(5), f(3), f(1));
}
