// Fonts that ship with the app. Only the Latin subset is bundled; other scripts fall back to system fonts.
import bebas from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2?url';
import caveat from '@fontsource-variable/caveat/files/caveat-latin-wght-normal.woff2?url';
import inter from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import interItalic from '@fontsource-variable/inter/files/inter-latin-wght-italic.woff2?url';
import mono from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url';
import slab from '@fontsource-variable/roboto-slab/files/roboto-slab-latin-wght-normal.woff2?url';

export type BundledFont = {
  family: string;
  label: string;
  faces: { url: string; style: 'normal' | 'italic'; weight: string }[];
};

export const BUNDLED_FONTS: readonly BundledFont[] = [
  {
    family: 'Inter',
    label: 'Inter (clean)',
    faces: [
      { url: inter, style: 'normal', weight: '100 900' },
      { url: interItalic, style: 'italic', weight: '100 900' },
    ],
  },
  {
    family: 'Roboto Slab',
    label: 'Roboto Slab (serif)',
    faces: [{ url: slab, style: 'normal', weight: '100 900' }],
  },
  {
    family: 'Bebas Neue',
    label: 'Bebas Neue (headline)',
    faces: [{ url: bebas, style: 'normal', weight: '400' }],
  },
  {
    family: 'Caveat',
    label: 'Caveat (handwritten)',
    faces: [{ url: caveat, style: 'normal', weight: '400 700' }],
  },
  {
    family: 'JetBrains Mono',
    label: 'JetBrains Mono (code)',
    faces: [{ url: mono, style: 'normal', weight: '100 800' }],
  },
];

export const FONT_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2'];

// A family name for a user font that can't collide with a bundled one or the CSS generics.
export function familyFor(fileName: string, taken: readonly string[]): string {
  const stem =
    fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[^\p{L}\p{N} _-]+/gu, ' ')
      .trim() || 'Font';
  const used = new Set(
    [...BUNDLED_FONTS.map((f) => f.family), ...taken].map((f) => f.toLowerCase()),
  );
  let family = `${stem} (yours)`;
  for (let n = 2; used.has(family.toLowerCase()); n++) family = `${stem} (yours ${n})`;
  return family;
}
