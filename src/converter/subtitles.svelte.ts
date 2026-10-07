// Adding a subtitle file to a video as a soft track, without re-encoding.
import type { SubtitleFormat } from '../captions/cues';
import { avPool, scheduler } from '../engine';
import { subtitleContainer } from '../engine/av/plan';
import { downloads } from '../engine/downloads.svelte';
import { messageOf } from '../engine/errors';
import type { Task } from '../engine/scheduler/scheduler.svelte';
import { plainError } from './errors';
import { files, type FileItem } from './files.svelte';
import type { Output } from './run';
import { wakeLock } from './wake-lock';

const MB = 1024 * 1024;

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
};

export type MuxInput = {
  video: Blob;
  format: string; // the video's format id
  existing: number;
  duration: number | null;
  subtitles: Blob;
  subtitleFormat: SubtitleFormat;
  language: string | null;
};

export async function muxSubtitles(
  input: MuxInput,
  onTask: (task: Task<Uint8Array>) => void,
): Promise<{ blob: Blob; ext: string }> {
  const ffmpegDir = await downloads.ensure('ffmpeg');
  const ext = subtitleContainer(input.format);
  const video = new File([input.video], `video.${input.format || 'bin'}`);
  const subtitles = new File([input.subtitles], `subtitles.${input.subtitleFormat}`);
  const task = scheduler.submit({
    pool: avPool,
    slots: 1,
    memory: 400 * MB + Math.min(input.video.size, 1024 * MB),
    run: (api, jobId) =>
      api.muxSubtitles(
        jobId,
        ffmpegDir,
        video,
        subtitles,
        {
          video: video.name,
          subtitles: subtitles.name,
          subtitleFormat: input.subtitleFormat,
          container: input.format,
          existing: input.existing,
          language: input.language,
        },
        input.duration,
      ),
  });
  onTask(task);
  const bytes = await task.result;
  return {
    blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: MIME[ext] ?? 'video/x-matroska' }),
    ext,
  };
}

type State =
  | { status: 'idle' }
  | { status: 'running'; taskId: string | null }
  | { status: 'done'; output: Output }
  | { status: 'failed'; message: string; detail: string };

class SubtitleAdder {
  videoId = $state<string | null>(null);
  subtitleId = $state<string | null>(null);
  language = $state('');
  state = $state.raw<State>({ status: 'idle' });
  private task: Task<Uint8Array> | null = null;

  videos(): FileItem[] {
    return files.items.filter(
      (item) =>
        item.status === 'ready' &&
        item.inspection?.sniffed.kind === 'video' &&
        item.inspection.av?.native !== false,
    );
  }

  subtitleFiles(): FileItem[] {
    return files.items.filter(
      (item) => item.status === 'ready' && item.inspection?.sniffed.kind === 'subtitle',
    );
  }

  available(): boolean {
    return this.videos().length > 0 && this.subtitleFiles().length > 0;
  }

  cancel(): void {
    this.task?.cancel();
    this.task = null;
    this.state = { status: 'idle' };
    wakeLock.release('subtitles');
  }

  async start(): Promise<void> {
    const video = this.videos().find((v) => v.id === this.videoId) ?? this.videos()[0];
    const subs =
      this.subtitleFiles().find((s) => s.id === this.subtitleId) ?? this.subtitleFiles()[0];
    if (!video || !subs) return;
    this.state = { status: 'running', taskId: null };
    wakeLock.hold('subtitles');
    try {
      const format = video.inspection!.sniffed.format ?? 'mp4';
      const language = /^[a-z]{3}$/i.test(this.language.trim())
        ? this.language.trim().toLowerCase()
        : null;
      const { blob, ext } = await muxSubtitles(
        {
          video: video.file,
          format,
          existing: video.inspection!.av?.subtitles.length ?? 0,
          duration: video.inspection!.duration ?? null,
          subtitles: subs.file,
          subtitleFormat: (subs.inspection!.sniffed.format ?? 'srt') as SubtitleFormat,
          language,
        },
        (task) => {
          this.task = task;
          this.state = { status: 'running', taskId: task.id };
        },
      );
      const stem = video.file.name.replace(/\.[^.]+$/, '');
      const notes =
        ext !== format ? [`Saved as ${ext.toUpperCase()}, which can hold subtitle tracks`] : [];
      this.state = { status: 'done', output: { blob, name: `${stem}-subtitled.${ext}`, notes } };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      this.state = { status: 'failed', message: plainError(error), detail: messageOf(error) };
    } finally {
      this.task = null;
      wakeLock.release('subtitles');
    }
  }
}

export const subtitleAdder = new SubtitleAdder();
