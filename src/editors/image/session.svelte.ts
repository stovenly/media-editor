// Main-thread side of an editing session: one worker, renders coalesced so only the latest edit is drawn.
import * as Comlink from 'comlink';
import { scheduler } from '../../engine';
import { downloads } from '../../engine/downloads.svelte';
import { planImage } from '../../engine/image/router';
import type { Inspection } from '../../io/inspect';
import type { ImageEdit, Rect } from '../../project/image-edit';
import type { EditorApi, Stage } from '../../workers/editor.worker';

export class EditorSession {
  bitmap = $state.raw<ImageBitmap | null>(null);
  detail = $state.raw<{ bitmap: ImageBitmap; region: Rect; key: string } | null>(null);
  size = $state.raw<{ width: number; height: number; scale: number } | null>(null);
  error = $state<string | null>(null);
  busy = $state(false);

  private worker: Worker;
  private api: Comlink.Remote<EditorApi>;
  private wanted: { edit: ImageEdit; stage: Stage } | null = null;
  private rendering = false;
  private wantedDetail: {
    edit: ImageEdit;
    stage: Stage;
    region: Rect;
    width: number;
    height: number;
    key: string;
  } | null = null;
  private detailing = false;
  private ready: Promise<void>;

  constructor(file: File, inspection: Inspection) {
    this.worker = new Worker(new URL('../../workers/editor.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.api = Comlink.wrap<EditorApi>(this.worker);
    this.ready = this.open(file, inspection);
  }

  private async open(file: File, inspection: Inspection): Promise<void> {
    const format = inspection.sniffed.format ?? '';
    const plan = planImage({ format, pages: 1 }, 'png');
    try {
      const [vips, magick] = await Promise.all([
        downloads.ensure('vips'),
        plan.decoder === 'vips' ? undefined : downloads.ensure('magick'),
      ]);
      this.size = await this.api.open(
        file,
        format,
        { vips, magick },
        Math.max(1, Math.min(4, scheduler.limit)),
      );
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  render(edit: ImageEdit, stage: Stage): void {
    this.wanted = { edit, stage };
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.rendering) return;
    this.rendering = true;
    this.busy = true;
    try {
      await this.ready;
      while (this.wanted) {
        const { edit, stage } = this.wanted;
        this.wanted = null;
        const bitmap = await this.api.render(edit, stage);
        this.bitmap?.close();
        this.bitmap = bitmap;
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.rendering = false;
      this.busy = false;
    }
  }

  // Full-resolution pixels for the visible part of a zoomed view; `key` ties the result to the edit it shows.
  requestDetail(
    edit: ImageEdit,
    stage: Stage,
    region: Rect,
    width: number,
    height: number,
    key: string,
  ): void {
    this.wantedDetail = { edit, stage, region, width, height, key };
    void this.pumpDetail();
  }

  clearDetail(): void {
    this.wantedDetail = null;
    this.detail?.bitmap.close();
    this.detail = null;
  }

  private async pumpDetail(): Promise<void> {
    if (this.detailing) return;
    this.detailing = true;
    try {
      await this.ready;
      while (this.wantedDetail) {
        const { edit, stage, region, width, height, key } = this.wantedDetail;
        this.wantedDetail = null;
        const bitmap = await this.api.detail(edit, stage, region, width, height);
        this.detail?.bitmap.close();
        this.detail = { bitmap, region, key };
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.detailing = false;
    }
  }

  close(): void {
    this.detail?.bitmap.close();
    this.bitmap?.close();
    this.bitmap = null;
    this.worker.terminate();
  }
}
