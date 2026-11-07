// Resolves theme custom properties to rgb() strings a canvas can use.
// Canvas fill styles can't parse var() or light-dark(), and fall back to black when given one.
export function themeColours<K extends string>(tokens: Record<K, string>): Record<K, string> {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  document.body.append(probe);
  const resolved = {} as Record<K, string>;
  for (const [key, name] of Object.entries(tokens) as [K, string][]) {
    probe.style.color = `var(${name})`;
    resolved[key] = getComputedStyle(probe).color;
  }
  probe.remove();
  return resolved;
}

// Black or white, whichever reads better on a #rrggbb or rgb() fill.
export function labelOn(fill: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(fill.trim())?.[1];
  const rgb = hex
    ? [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
    : /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(fill.trim())?.slice(1, 4).map(Number);
  if (!rgb) return '#ffffff';
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.18 ? '#000000' : '#ffffff';
}
