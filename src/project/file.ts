// Project files: one JSON schema for all three editors, referring to media by fingerprint rather than by bytes.
import type { MediaKind } from '../io/formats';
import type { AudioProject } from './audio';
import type { ImageEdit } from './image-edit';
import type { VideoProject } from './video';

export const PROJECT_EXTENSION = '.mediaproject.json';
export const BUNDLE_EXTENSION = '.mediaproject.zip';
const APP = 'media-editor';

export type ProjectAsset = {
  id: string;
  name: string;
  size: number; // bytes
  hash: string; // see `fingerprint`
  kind: MediaKind;
};

type Envelope = { app: typeof APP; version: 1; assets: ProjectAsset[] };

export type ProjectBody =
  | { kind: 'image'; edit: ImageEdit }
  | { kind: 'audio'; project: AudioProject }
  | { kind: 'video'; project: VideoProject };

export type SavedProject = Envelope & ProjectBody;

const SAMPLE = 1024 * 1024;

// SHA-256 over the size and three 1 MiB samples (start, middle, end), so multi-gigabyte files hash instantly.
export async function fingerprint(file: Blob): Promise<string> {
  const size = new Uint8Array(8);
  new DataView(size.buffer).setBigUint64(0, BigInt(file.size));
  const parts: BlobPart[] = [size];
  if (file.size <= SAMPLE * 3) parts.push(file);
  else {
    const middle = Math.floor(file.size / 2 - SAMPLE / 2);
    parts.push(
      file.slice(0, SAMPLE),
      file.slice(middle, middle + SAMPLE),
      file.slice(file.size - SAMPLE),
    );
  }
  const digest = await crypto.subtle.digest('SHA-256', await new Blob(parts).arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function serialize(project: SavedProject): string {
  return JSON.stringify(project, null, 2);
}

export function parseProject(text: string): SavedProject {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("This project file can't be read");
  }
  const p = value as Partial<SavedProject> | null;
  if (!p || p.app !== APP) throw new Error("This isn't a Media Editor project");
  if (p.version !== 1) throw new Error('This project was saved by a newer version of the app');
  if (!Array.isArray(p.assets) || !['image', 'audio', 'video'].includes(p.kind as string))
    throw new Error('This project file is damaged');
  if (p.kind === 'image' ? !('edit' in p) : !('project' in p))
    throw new Error('This project file is damaged');
  return p as SavedProject;
}

export function isProjectName(name: string): 'json' | 'bundle' | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(PROJECT_EXTENSION)) return 'json';
  if (lower.endsWith(BUNDLE_EXTENSION)) return 'bundle';
  return null;
}

// Rewrites every `assetId` in an editor project from saved ids to the ids of the files now open.
export function remapAssets<T>(value: T, ids: ReadonlyMap<string, string>): T {
  if (Array.isArray(value)) return value.map((v: unknown) => remapAssets(v, ids)) as T;
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = key === 'assetId' && typeof v === 'string' ? (ids.get(v) ?? v) : remapAssets(v, ids);
  }
  return out as T;
}

export function projectStem(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_') || 'project';
}

export const bundleMediaName = (asset: ProjectAsset) => `media/${asset.id}/${asset.name}`;
export const bundleFontName = (font: { id: string; name: string }) =>
  `fonts/${font.id}/${font.name}`;
