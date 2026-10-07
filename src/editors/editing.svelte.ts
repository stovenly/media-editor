// Which editor is open, and the saved project it should start from.
import type { FileItem } from '../converter/files.svelte';
import type { AudioProject } from '../project/audio';
import type { VideoProject } from '../project/video';

export type Restore =
  | { kind: 'audio'; items: FileItem[]; project: AudioProject }
  | { kind: 'video'; items: FileItem[]; project: VideoProject; fonts: ReadonlyMap<string, File> };

class Editing {
  current = $state.raw<{ item: FileItem; restore?: Restore } | null>(null);

  open(item: FileItem, restore?: Restore): void {
    this.current = { item, restore };
  }

  close(): void {
    this.current = null;
  }
}

export const editing = new Editing();
