import ExifReader from 'exifreader';

export type MetadataField = { group: string; name: string; value: string };

export type MetadataSummary = {
  location: boolean;
  thumbnail: boolean;
  provenance: boolean;
  hdr: boolean;
  motion: boolean;
  fields: MetadataField[];
};

const GROUPS: Record<string, string> = {
  exif: 'Camera',
  gps: 'Location',
  iptc: 'Description',
  xmp: 'XMP',
  icc: 'Colour profile',
  file: 'File',
  makerNotes: 'Maker notes',
  photoshop: 'Photoshop',
};

const SKIPPED_GROUPS = new Set([
  'file',
  'Thumbnail',
  'thumbnail',
  'jfif',
  'pngFile',
  'riff',
  'gif',
]);

export function readMetadata(buffer: ArrayBuffer): MetadataSummary {
  const text = latin1(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1 << 20)));
  const summary: MetadataSummary = {
    location: false,
    thumbnail: false,
    provenance: /c2pa|jumbf/i.test(text),
    hdr:
      text.includes('hdrgm:') ||
      text.includes('urn:iso:std:iso:ts:21496') ||
      text.includes('HDRGainMap'),
    motion: text.includes('MotionPhoto') || text.includes('MicroVideo'),
    fields: [],
  };
  let tags: Record<string, unknown>;
  try {
    tags = ExifReader.load(buffer, {
      expanded: true,
      includeUnknown: false,
      excludeTags: { xmp: true },
    }) as Record<string, unknown>;
  } catch {
    return summary;
  }
  const gps = tags.gps as { Latitude?: number; Longitude?: number } | undefined;
  summary.location = gps?.Latitude !== undefined || gps?.Longitude !== undefined;
  summary.thumbnail = Boolean(tags.Thumbnail ?? tags.thumbnail);
  for (const [group, values] of Object.entries(tags)) {
    if (SKIPPED_GROUPS.has(group) || !values || typeof values !== 'object') continue;
    for (const [name, tag] of Object.entries(values as Record<string, unknown>)) {
      const value = describe(tag);
      if (value) summary.fields.push({ group: GROUPS[group] ?? group, name, value });
    }
  }
  return summary;
}

function describe(tag: unknown): string {
  if (typeof tag === 'number' || typeof tag === 'string') return String(tag);
  if (!tag || typeof tag !== 'object') return '';
  const description = (tag as { description?: unknown }).description;
  if (typeof description !== 'string' && typeof description !== 'number') return '';
  const text = String(description).replace(/\s+/g, ' ').trim();
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function latin1(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}
