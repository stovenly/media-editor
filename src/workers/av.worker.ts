import * as Comlink from 'comlink';
import { runFfmpeg } from '../engine/av/ffmpeg';
import { convertNative, NeedsFfmpeg } from '../engine/av/native';
import {
  animationWidth,
  clipDuration,
  ffmpegArgs,
  slideshowJob,
  subtitleMuxJob,
  type SubtitleMux,
  type AvSettings,
  type Route,
  type Slideshow,
} from '../engine/av/plan';
import { messageOf } from '../engine/errors';
import { target } from '../engine/targets';
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

const SAMPLE_SECONDS = 2;
const SAMPLE_SHARE = 0.1; // of the progress bar
const SAMPLE_ROUNDS = 4;
const MIN_WIDTH = 160; // px
const MIN_FPS = 6;

const megabytes = (bytes: number) =>
  `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;

// Animated images have no bitrate to aim for, so a short sample from the middle of the clip predicts the
// size, and the width, then the frame rate, come down to fit.
async function fitAnimated(
  job: AvJob,
  settings: AvSettings,
  duration: number,
  progress: (fraction: number) => void,
): Promise<{ settings: AvSettings; notes: string[] }> {
  const video = job.probe?.video;
  const limit = settings.targetBytes;
  if (!limit || !video || !job.ffmpegDir || duration <= SAMPLE_SECONDS * 1.5)
    return { settings, notes: [] };
  const start = (settings.trimStart ?? 0) + (duration - SAMPLE_SECONDS) / 2;
  const originalWidth = animationWidth(job.probe, settings);
  const originalFps = Math.min(settings.gif.fps, video.fps ?? settings.gif.fps);
  let width = originalWidth;
  let fps = originalFps;
  // Size isn't proportional to the pixel count, so each guess is measured again before the real encode.
  for (let round = 0; round < SAMPLE_ROUNDS; round++) {
    const sample = {
      ...settings,
      trimStart: start,
      trimEnd: start + SAMPLE_SECONDS,
      height: null,
      gif: { ...settings.gif, width, fps },
    };
    const sampleJob = ffmpegArgs(job.file.name, job.probe, sample);
    let bytes = await runFfmpeg(job.ffmpegDir, [job.file], sampleJob, SAMPLE_SECONDS, (f) =>
      progress(((round + f * (sampleJob.raw ? 0.5 : 1)) / SAMPLE_ROUNDS) * SAMPLE_SHARE),
    );
    if (sampleJob.raw) bytes = await gifski(bytes, sampleJob.raw, settings.quality);
    const predicted = (bytes.length / SAMPLE_SECONDS) * duration;
    if (predicted <= limit * 0.95) break;
    if (width <= MIN_WIDTH && fps <= MIN_FPS) break;
    const ratio = (limit * 0.9) / predicted;
    const area = Math.max(ratio, Math.min(1, (MIN_WIDTH / width) ** 2));
    width = Math.max(2, Math.round((width * Math.sqrt(area)) / 2) * 2);
    fps = Math.max(MIN_FPS, Math.min(fps, Math.round(fps * (ratio / area))));
  }
  progress(SAMPLE_SHARE);
  if (width === originalWidth && fps === originalFps) return { settings, notes: [] };
  const notes = [
    `Made ${width} px wide${fps < originalFps ? ` at ${fps} fps` : ''} to fit ${megabytes(limit)}`,
  ];
  return { settings: { ...settings, height: null, gif: { ...settings.gif, width, fps } }, notes };
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
      const duration = job.probe ? clipDuration(job.probe, settings) : null;
      const animated = target(settings.target).group === 'animated';
      const fitted =
        animated && duration
          ? await fitAnimated(job, settings, duration, progress)
          : { settings, notes: [] };
      const start = fitted.notes.length || (animated && settings.targetBytes) ? SAMPLE_SHARE : 0;
      const ffmpegJob = ffmpegArgs(job.file.name, job.probe, fitted.settings);
      let bytes = await runFfmpeg(job.ffmpegDir, [job.file], ffmpegJob, duration, (f) =>
        progress(start + (1 - start) * (ffmpegJob.raw ? f * 0.5 : f)),
      );
      if (ffmpegJob.raw) bytes = await gifski(bytes, ffmpegJob.raw, settings.quality);
      const notes = [...fitted.notes];
      if (settings.target === 'm4r' && job.probe && job.probe.duration > 40)
        notes.push('Cut to 40 seconds, the longest an iPhone ringtone can be');
      if (animated && settings.targetBytes && bytes.length > settings.targetBytes)
        notes.push(
          `Came out at ${megabytes(bytes.length)}, over the ${megabytes(settings.targetBytes)} asked for`,
        );
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
  async muxSubtitles(
    jobId: string,
    ffmpegDir: string,
    video: File,
    subtitles: File,
    mux: SubtitleMux,
    duration: number | null,
  ): Promise<Uint8Array> {
    try {
      const bytes = await runFfmpeg(
        ffmpegDir,
        [video, subtitles],
        subtitleMuxJob({ ...mux, video: video.name, subtitles: subtitles.name }),
        duration,
        (fraction) => reportProgress(jobId, fraction),
      );
      return Comlink.transfer(bytes, [bytes.buffer as ArrayBuffer]);
    } catch (error) {
      throw new Error(messageOf(error), { cause: error });
    }
  },
};

export type AvApi = typeof api;

Comlink.expose(api);
