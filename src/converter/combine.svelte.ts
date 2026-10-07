// Combining several files into one: images into an animation or slideshow, optionally over audio.
import { avPool, imagePool, scheduler } from '../engine';
import { downloads } from '../engine/downloads.svelte';
import { messageOf } from '../engine/errors';
import { planImage } from '../engine/image/router';
import type { Task } from '../engine/scheduler/scheduler.svelte';
import { target } from '../engine/targets';
import { plainError } from './errors';
import { files, type FileItem } from './files.svelte';
import { imageSettings, startJob, type Output } from './run';
import { wakeLock } from './wake-lock';

export type CombineTarget = 'mp4' | 'webm' | 'gif-anim' | 'webp-anim' | 'apng';

export const COMBINE_TARGETS: readonly CombineTarget[] = [
  'mp4',
  'webm',
  'gif-anim',
  'webp-anim',
  'apng',
];

type CombineState =
  | { status: 'idle' }
  | { status: 'running'; taskId: string | null; started: number }
  | { status: 'done'; output: Output }
  | { status: 'failed'; message: string; detail: string };

const VIDEO_EDGE = 1920;
const MB = 1024 * 1024;

class Combine {
  target = $state<CombineTarget>('mp4');
  seconds = $state(2);
  audioId = $state<string | null>(null);
  state = $state.raw<CombineState>({ status: 'idle' });

  private cancelled = false;
  private tasks: Task<unknown>[] = [];

  images(): FileItem[] {
    return files.items.filter(
      (item) => item.status === 'ready' && item.inspection?.sniffed.kind === 'image',
    );
  }

  audios(): FileItem[] {
    return files.items.filter(
      (item) => item.status === 'ready' && item.inspection?.sniffed.kind === 'audio',
    );
  }

  available(): boolean {
    const images = this.images().length;
    return images >= 2 || (images >= 1 && this.audios().length >= 1);
  }

  cancel(): void {
    this.cancelled = true;
    for (const task of this.tasks) task.cancel();
    this.tasks = [];
    this.state = { status: 'idle' };
    wakeLock.release('combine');
  }

  async start(): Promise<void> {
    const images = this.images();
    const audio = this.audios().find((item) => item.id === this.audioId) ?? null;
    if (images.length === 0) return;
    this.cancelled = false;
    this.tasks = [];
    this.state = { status: 'running', taskId: null, started: performance.now() };
    wakeLock.hold('combine');
    try {
      const output =
        target(this.target).group === 'animated'
          ? await this.animate(images)
          : await this.slideshow(images, audio);
      if (!this.cancelled) this.state = { status: 'done', output };
    } catch (error) {
      if (this.cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
      this.state = { status: 'failed', message: plainError(error), detail: messageOf(error) };
    } finally {
      wakeLock.release('combine');
    }
  }

  private track<T>(task: Task<T>): Promise<T> {
    if (this.cancelled) {
      task.cancel();
      throw new DOMException('Cancelled', 'AbortError');
    }
    this.tasks.push(task as Task<unknown>);
    if (this.state.status === 'running') this.state = { ...this.state, taskId: task.id };
    return task.result;
  }

  private async animate(images: FileItem[]): Promise<Output> {
    const needsMagick = images.some(
      (item) =>
        planImage({ format: item.inspection!.sniffed.format ?? '', pages: 1 }, 'png').decoder !==
        'vips',
    );
    const [vips, magick] = await Promise.all([
      downloads.ensure('vips'),
      needsMagick ? downloads.ensure('magick') : undefined,
    ]);
    const out = target(this.target);
    const frames = images.map((item) => ({
      file: item.file,
      format: item.inspection!.sniffed.format ?? '',
    }));
    const settings = imageSettings(this.target, files.options);
    const delay = this.seconds * 1000;
    const bytes = images.reduce((sum, item) => sum + item.file.size, 0);
    const result = await this.track(
      scheduler.submit({
        pool: imagePool,
        memory: 256 * MB + bytes * 4,
        run: (api, jobId) => api.animate(jobId, frames, delay, { vips, magick }, settings),
      }),
    );
    return {
      blob: new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: out.mime }),
      name: `animation.${out.ext}`,
      notes: result.notes,
      width: result.width,
      height: result.height,
    };
  }

  private async slideshow(images: FileItem[], audio: FileItem | null): Promise<Output> {
    const options = {
      ...files.options,
      maxEdge: Math.min(files.options.maxEdge ?? VIDEO_EDGE, VIDEO_EDGE),
      targetMb: null,
      metadata: 'none' as const,
    };
    const pngs = await Promise.all(
      images.map((item) => {
        const job = startJob({
          file: item.file,
          inspection: item.inspection!,
          targetId: 'png',
          options,
          threads: 1,
          onTask: () => {},
        });
        return job.result;
      }),
    );
    if (this.cancelled) throw new DOMException('Cancelled', 'AbortError');
    const digits = String(pngs.length).length;
    const frames = pngs.map(
      (png, index) =>
        new File([png.blob], `frame-${String(index + 1).padStart(digits, '0')}.png`, {
          type: 'image/png',
        }),
    );
    const first = pngs[0]!;
    const ffmpegDir = await downloads.ensure('ffmpeg');
    const out = target(this.target);
    const audioFile = audio
      ? new File([audio.file], `audio-${audio.file.name.replace(/[^\w.-]/g, '_')}`)
      : null;
    const show = {
      frames: frames.map((frame) => frame.name),
      secondsPerImage: this.seconds,
      audio:
        audio && audioFile
          ? { name: audioFile.name, duration: audio.inspection?.duration ?? 60 }
          : null,
      target: this.target as 'mp4' | 'webm',
      size: { width: first.width ?? 1280, height: first.height ?? 720 },
      quality: files.options.quality,
    };
    const bytes = await this.track(
      scheduler.submit({
        pool: avPool,
        memory: 700 * MB + frames.reduce((sum, frame) => sum + frame.size, 0),
        run: (api, jobId) => api.slideshow(jobId, ffmpegDir, frames, audioFile, show),
      }),
    );
    const stem =
      audio && images.length === 1 ? audio.file.name.replace(/\.[^.]+$/, '') : 'slideshow';
    return {
      blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: out.mime }),
      name: `${stem}.${out.ext}`,
      notes: [],
    };
  }
}

export const combine = new Combine();
