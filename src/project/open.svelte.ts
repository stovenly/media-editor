// Re-opening a saved project: unpack a bundle, or match the user's files to the project by fingerprint.
import { files, type FileItem } from '../converter/files.svelte';
import { editing } from '../editors/editing.svelte';
import { messageOf } from '../engine/errors';
import { readZip } from '../io/unzip';
import {
  bundleFontName,
  bundleMediaName,
  fingerprint,
  isProjectName,
  parseProject,
  remapAssets,
  type ProjectAsset,
  type SavedProject,
} from './file';
import { normalizeVideoProject } from './video';

export type Pending = {
  name: string;
  saved: SavedProject;
  matched: ReadonlyMap<string, string>; // saved asset id → open FileItem id
  fonts: ReadonlyMap<string, File>; // ProjectFont id → file
};

class Projects {
  pending = $state.raw<Pending | null>(null);
  error = $state<string | null>(null);
  private hashes = new Map<string, Promise<string>>();
  private matching = false;

  // Opens any project files among `list` and passes the rest to the converter.
  intake(list: File[]): void {
    const projects = list.filter((file) => isProjectName(file.name));
    const media = list.filter((file) => !isProjectName(file.name));
    if (media.length) {
      files.add(media);
      if (this.pending) void this.match();
    }
    if (projects[0]) void this.open(projects[0]);
  }

  async open(file: File): Promise<void> {
    this.error = null;
    try {
      if (isProjectName(file.name) === 'bundle') await this.openBundle(file);
      else
        this.pending = {
          name: file.name,
          saved: parseProject(await file.text()),
          matched: new Map(),
          fonts: new Map(),
        };
      await this.match();
    } catch (error) {
      this.error = messageOf(error);
    }
  }

  private async openBundle(file: File): Promise<void> {
    const entries = await readZip(file);
    const json = entries.find((e) => e.name === 'project.json');
    if (!json) throw new Error("This bundle doesn't contain a project");
    const saved = parseProject(await (await json.read()).text());
    const media = await Promise.all(
      saved.assets.map(async (asset) => {
        const entry = entries.find((e) => e.name === bundleMediaName(asset));
        if (!entry) return null;
        return { asset, file: new File([await entry.read()], asset.name) };
      }),
    );
    const found = media.filter((m) => m !== null);
    const added = files.add(found.map((m) => m.file));
    const matched = new Map(found.map((m, i) => [m.asset.id, added[i]!.id]));
    const fonts = new Map<string, File>();
    if (saved.kind === 'video')
      for (const font of saved.project.fonts ?? []) {
        const entry = entries.find((e) => e.name === bundleFontName(font));
        if (entry) fonts.set(font.id, new File([await entry.read()], font.name));
      }
    this.pending = { name: file.name, saved, matched, fonts };
  }

  missing(): ProjectAsset[] {
    const pending = this.pending;
    return pending ? pending.saved.assets.filter((a) => !pending.matched.has(a.id)) : [];
  }

  addFonts(list: File[]): void {
    const pending = this.pending;
    if (!pending || pending.saved.kind !== 'video') return;
    const fonts = new Map(pending.fonts);
    for (const font of pending.saved.project.fonts ?? []) {
      const file = list.find((f) => f.name === font.name);
      if (file) fonts.set(font.id, file);
    }
    this.pending = { ...pending, fonts };
  }

  cancel(): void {
    this.pending = null;
    this.error = null;
  }

  // Matches open files to missing assets (size first, then fingerprint), and opens the editor once all are ready.
  async match(): Promise<void> {
    if (this.matching) return;
    this.matching = true;
    try {
      let pending = this.pending;
      if (!pending) return;
      const used = new Set(pending.matched.values());
      const matched = new Map(pending.matched);
      for (const asset of this.missing()) {
        for (const item of files.items) {
          if (used.has(item.id) || item.file.size !== asset.size) continue;
          if ((await this.hash(item)) !== asset.hash) continue;
          matched.set(asset.id, item.id);
          used.add(item.id);
          break;
        }
      }
      if (this.pending !== pending) return;
      pending = { ...pending, matched };
      this.pending = pending;
      this.openWhenReady();
    } catch (error) {
      this.error = messageOf(error);
    } finally {
      this.matching = false;
    }
  }

  openWhenReady(): void {
    const pending = this.pending;
    if (!pending || this.missing().length) return;
    const items = pending.saved.assets.map((a) =>
      files.items.find((item) => item.id === pending.matched.get(a.id)),
    );
    if (items.some((item) => !item)) return;
    const ready = items as FileItem[];
    if (ready.some((item) => item.status === 'inspecting')) return;
    const broken = ready.find((item) => item.status !== 'ready');
    if (broken) {
      this.error = `${broken.file.name} can't be opened`;
      return;
    }
    const saved = pending.saved;
    this.pending = null;
    const first = ready[0];
    if (!first) {
      this.error = 'This project has no media';
      return;
    }
    if (saved.kind === 'image') {
      files.setEdit(first.id, saved.edit);
      editing.open(files.items.find((i) => i.id === first.id)!);
    } else if (saved.kind === 'audio') {
      editing.open(first, {
        kind: 'audio',
        items: ready,
        project: remapAssets(saved.project, pending.matched),
      });
    } else {
      editing.open(first, {
        kind: 'video',
        items: ready,
        project: normalizeVideoProject(remapAssets(saved.project, pending.matched)),
        fonts: pending.fonts,
      });
    }
  }

  private hash(item: FileItem): Promise<string> {
    let hash = this.hashes.get(item.id);
    if (!hash) {
      hash = fingerprint(item.file);
      this.hashes.set(item.id, hash);
    }
    return hash;
  }
}

export const projects = new Projects();
