// Saving a project as JSON, or as a ZIP bundle that also carries the media and user fonts.
import type { FileItem } from '../converter/files.svelte';
import { scheduler, zipPool } from '../engine';
import { downloadBlob } from '../io/download';
import type { ZipEntry } from '../io/zip';
import {
  BUNDLE_EXTENSION,
  bundleFontName,
  bundleMediaName,
  fingerprint,
  PROJECT_EXTENSION,
  projectStem,
  serialize,
  type ProjectAsset,
  type ProjectBody,
  type SavedProject,
} from './file';
import type { ProjectFont } from './text';

export async function saveProject(
  name: string,
  body: ProjectBody,
  items: readonly FileItem[],
  options: { bundle: boolean; fonts?: readonly { font: ProjectFont; file: File }[] },
): Promise<void> {
  const assets: ProjectAsset[] = await Promise.all(
    items.map(async (item) => ({
      id: item.id,
      name: item.file.name,
      size: item.file.size,
      hash: await fingerprint(item.file),
      kind: item.inspection?.sniffed.kind ?? 'video',
    })),
  );
  const saved = { app: 'media-editor', version: 1, assets, ...body } as SavedProject;
  const json = serialize(saved);
  const stem = projectStem(name);
  if (!options.bundle) {
    downloadBlob(new Blob([json], { type: 'application/json' }), `${stem}${PROJECT_EXTENSION}`);
    return;
  }
  const entries: ZipEntry[] = [
    { name: 'project.json', bytes: new TextEncoder().encode(json) },
    ...items.map((item, i) => ({ name: bundleMediaName(assets[i]!), bytes: item.file })),
    ...(options.fonts ?? []).map(({ font, file }) => ({ name: bundleFontName(font), bytes: file })),
  ];
  const task = scheduler.submit({
    pool: zipPool,
    memory:
      entries.reduce(
        (sum, e) => sum + (e.bytes instanceof Blob ? e.bytes.size : e.bytes.length),
        0,
      ) * 2,
    run: (api) => api.zip(entries),
  });
  downloadBlob(await task.result, `${stem}${BUNDLE_EXTENSION}`);
}
