// Value formatting and parsing shared by Slider and NumberField.

// m:ss.ff, or h:mm:ss.ff from an hour, rounded to hundredths of a second.
export function formatTime(seconds: number): string {
  const total = Math.round(Math.max(0, seconds) * 100);
  const hours = Math.floor(total / 360_000);
  const minutes = Math.floor(total / 6000) % 60;
  const rest = ((total % 6000) / 100).toFixed(2).padStart(5, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

// Accepts plain seconds, m:ss.ff and h:mm:ss.ff; null for anything else.
export function parseTime(text: string): number | null {
  const parts = text.trim().replace(/s$/i, '').trim().replace(',', '.').split(':');
  if (parts.length > 3) return null;
  const last = parts.pop()!;
  if (!/^(\d+\.?\d*|\.\d+)$/.test(last) || parts.some((p) => !/^\d+$/.test(p))) return null;
  const seconds = Number(last);
  const [minutes = 0, hours = 0] = parts.map(Number).reverse();
  if (parts.length > 0 && seconds >= 60) return null;
  if (parts.length > 1 && minutes >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export function parseNumber(text: string, unit = ''): number | null {
  let clean = text.trim().replace(/−/g, '-').replace(',', '.');
  if (unit && clean.toLowerCase().endsWith(unit.toLowerCase()))
    clean = clean.slice(0, -unit.length).trim();
  if (clean.startsWith('+')) clean = clean.slice(1);
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(clean)) return null;
  return Number(clean);
}

export function decimalsOf(step: number): number {
  const text = String(step);
  const exponent = text.match(/e-(\d+)$/);
  if (exponent) return Number(exponent[1]);
  return text.split('.')[1]?.length ?? 0;
}

const TIGHT_UNITS = new Set(['%', '×', '°']);

export function formatValue(value: number, decimals: number, unit = '', signed = false): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const zero = Number(fixed) === 0;
  const sign = zero ? '' : value < 0 ? '−' : signed ? '+' : '';
  const suffix = !unit ? '' : TIGHT_UNITS.has(unit) ? unit : ` ${unit}`;
  return `${sign}${fixed}${suffix}`;
}

export const clamp = (value: number, min = -Infinity, max = Infinity) =>
  Math.min(max, Math.max(min, value));

// The nearest point on the min + n·step grid, matching how bits-ui's Slider snaps.
export function snapToStep(value: number, min: number, max: number, step: number): number {
  const places = decimalsOf(step);
  const factor = 10 ** places;
  const last = Math.floor(Math.round((max - min) * factor) / Math.round(step * factor));
  const index = clamp(Math.round((value - min) / step), 0, last);
  return Number((min + index * step).toFixed(places));
}
