import { describe, expect, it } from 'vitest';
import { alphaOf, hsvHex, hsvOf, parseHex, withAlpha } from '../../src/app/ui/colour';

describe('parseHex', () => {
  it('accepts short and long forms, with or without #', () => {
    expect(parseHex('#FFF')).toBe('#ffffff');
    expect(parseHex('00ff00')).toBe('#00ff00');
    expect(parseHex(' #0047BB ')).toBe('#0047bb');
  });

  it('accepts an alpha pair only when asked', () => {
    expect(parseHex('#000000b3')).toBeNull();
    expect(parseHex('#000000b3', true)).toBe('#000000b3');
  });

  it('rejects anything else', () => {
    expect(parseHex('')).toBeNull();
    expect(parseHex('#12345')).toBeNull();
    expect(parseHex('red')).toBeNull();
  });
});

describe('alpha', () => {
  it('reads and writes the alpha pair', () => {
    expect(alphaOf('#000000')).toBe(1);
    expect(alphaOf('#00000080')).toBeCloseTo(0.5, 2);
    expect(withAlpha('#000000', 0.7)).toBe('#000000b3');
    expect(withAlpha('#123456ff', 0)).toBe('#12345600');
  });
});

describe('hsv', () => {
  it('round-trips colours', () => {
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0047bb', '#4f46e5', '#808080'])
      expect(hsvHex(hsvOf(hex))).toBe(hex);
  });

  it('gives hue in degrees and saturation and value as fractions', () => {
    expect(hsvOf('#00ff00')).toEqual({ h: 120, s: 1, v: 1 });
    expect(hsvHex({ h: 240, s: 1, v: 1 })).toBe('#0000ff');
    expect(hsvHex({ h: 360, s: 1, v: 1 })).toBe('#ff0000');
  });
});
