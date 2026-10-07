import type { ImageEdit } from '../../project/image-edit';

export type MetadataMode = 'none' | 'technical' | 'all';

export type ImageSettings = {
  target: string;
  quality: number; // 1..100
  lossless: boolean;
  maxEdge: number | null; // pixels, longest edge; never upscales
  background: string; // #rrggbb, used where transparency is flattened
  metadata: MetadataMode;
  targetBytes: number | null;
  gifThreshold: number; // 0..255; alpha below this becomes transparent in GIF
  hotspot: { x: number; y: number }; // pixels on the 32 px cursor
  maskableBackground: string; // #rrggbb
  keepHdr: boolean;
  edit?: ImageEdit | null;
};

export const DEFAULT_IMAGE_SETTINGS: Omit<ImageSettings, 'target'> = {
  quality: 82,
  lossless: false,
  maxEdge: null,
  background: '#ffffff',
  metadata: 'none',
  targetBytes: null,
  gifThreshold: 128,
  hotspot: { x: 0, y: 0 },
  maskableBackground: '#ffffff',
  keepHdr: true,
};

export type ImageResult = {
  bytes: Uint8Array;
  width: number;
  height: number;
  quality: number | null;
  notes: string[];
};
