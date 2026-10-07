import * as Comlink from 'comlink';
import { runFfmpeg } from '../engine/av/ffmpeg';
import { convertNative, NeedsFfmpeg } from '../engine/av/native';
import {
  clipDuration,
  ffmpegArgs,
  slideshowJob,
  type AvSettings,
  type Route,
  type Slideshow,
} from '../engine/av/plan';
import { messageOf } from '../engine/errors';
import type { AvProbe } from '../media/probe';
import { attachProgress, reportProgress } from './progress';

export type AvJob = {
  file: File;
  probe?: AvProbe;
  route: Route;
  ffmpegDir?: string;
};

export type AvResult =
  | { kind: 'done'; bytes: Uint8Array; notes: string[]; engine: Route }
  | { kind: 'needs-ffmpeg'; reason: string };

async function gifski(
  raw: Uint8Array,
  size: { width: number; height: number; fps: number },
  quality: number,
): Promise<Uint8Array> {
  const { default: encode } = await import('gifski-wasm');
  const frameBytes = size.width * size.height * 4;
  const frames: Uint8Array[] = [];
  for (let at = 0; at + frameBytes <= raw.length; at += frameBytes)
    frames.push(raw.subarray(at, at + frameBytes));
  if (frames.length < 2) frames.push(frames[0]!);
  return encode({
    frames,
    width: size.width,
    height: size.height,
    fps: size.fps,
    quality: Math.max(1, Math.min(100, quality)),
  });
}

const api = {
  attach: attachProgress,
  async convert(jobId: string, job: AvJob, settings: AvSettings): Promise<AvResult> {
    const progress = (fraction: number) => reportProgress(jobId, fraction);
    try {
      if (job.route === 'native' && job.probe) {
        try {
          const { bytes, notes } = await convertNative(job.file, job.probe, settings, progress);
          return Comlink.transfer({ kind: 'done', bytes, notes, engine: 'native' }, [
            bytes.buffer as ArrayBuffer,
          ]);
        } catch (error) {
          if (!(error instanceof NeedsFfmpeg)) throw error;
          if (!job.ffmpegDir) return { kind: 'needs-ffmpeg', reason: error.message };
        }
      }
      if (!job.ffmpegDir) return { kind: 'needs-ffmpeg', reason: 'FFmpeg route' };
      const ffmpegJob = ffmpegArgs(job.file.name, job.probe, settings);
      const duration = job.probe ? clipDuration(job.probe, settings) : null;
      let bytes = await runFfmpeg(job.ffmpegDir, [job.file], ffmpegJob, duration, (f) =>
        progress(ffmpegJob.raw ? f * 0.5 : f),
      );
      if (ffmpegJob.raw) bytes = await gifski(bytes, ffmpegJob.raw, settings.quality);
      const notes =
        settings.target === 'm4r' && job.probe && job.probe.duration > 40
          ? ['Cut to 40 seconds, the longest an iPhone ringtone can be']
          : [];
      return Comlink.transfer({ kind: 'done', bytes, notes, engine: 'ffmpeg' }, [
        bytes.buffer as ArrayBuffer,
      ]);
    } catch (error) {
      throw new Error(messageOf(error), { cause: error });
    }
  },
  async slideshow(
    jobId: string,
    ffmpegDir: string,
    frames: File[],
    audio: File | null,
    show: Slideshow,
  ): Promise<Uint8Array> {
    try {
      const job = slideshowJob(show);
      const total =
        show.audio && show.frames.length === 1
          ? show.audio.duration
          : show.frames.length * show.secondsPerImage;
      const files = audio ? [...frames, audio] : frames;
      const bytes = await runFfmpeg(
        ffmpegDir,
        files,
        job,
        total,
        (fraction) => reportProgress(jobId, fraction),
        [{ path: '/list.txt', data: job.list }],
      );
      return Comlink.transfer(bytes, [bytes.buffer as ArrayBuffer]);
    } catch (error) {
      throw new Error(messageOf(error), { cause: error });
    }
  },
};

export type AvApi = typeof api;

Comlink.expose(api);
