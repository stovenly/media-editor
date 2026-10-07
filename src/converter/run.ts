// Starts one conversion: picks the engine, makes sure it is downloaded, and submits it to the scheduler.
import { avPool, imagePool, scheduler } from '../engine';
import { routeAv, type AvSettings, type Route } from '../engine/av/plan';
import { downloads } from '../engine/downloads.svelte';
import { planImage } from '../engine/image/router';
import type { ImageSettings } from '../engine/image/settings';
import type { Task } from '../engine/scheduler/scheduler.svelte';
import { target, type Target } from '../engine/targets';
import type { Inspection } from '../io/inspect';
import type { ImageEdit } from '../project/image-edit';
import { DEFAULT_OPTIONS, type ConvertOptions } from './options';

export type Output = {
  blob: Blob;
  name: string;
  notes: string[];
  width?: number;
  height?: number;
  quality?: number | null;
};

export type Job = {
  result: Promise<Output>;
  cancel(): void;
};

export type JobInput = {
  file: File;
  inspection: Inspection;
  edit?: ImageEdit | null;
  targetId: string;
  options: ConvertOptions;
  threads: number;
  onTask: (taskId: string) => void;
};

export function startJob(input: JobInput): Job {
  let cancelled = false;
  let task: Task<unknown> | undefined;
  const abort = () => new DOMException('Cancelled', 'AbortError');
  const result = (async () => {
    const out = target(input.targetId);
    const kind = input.inspection.sniffed.kind;
    if (
      kind === 'image' &&
      (out.group === 'image' || out.group === 'animated' || out.group === 'icon')
    ) {
      const dirs = await imageEngines(input.inspection, input.targetId);
      if (cancelled) throw abort();
      const image = submitImage(input, out, dirs);
      task = image;
      input.onTask(image.id);
      return image.result;
    }
    if (out.id === 'motion' && input.inspection.motionOffset !== undefined) {
      const clip = input.file.slice(input.inspection.motionOffset, input.file.size, 'video/mp4');
      return {
        blob: clip,
        name: outputName(input.file.name, out.ext),
        notes: ['Extracted without re-encoding'],
      };
    }
    if (kind === 'audio' || kind === 'video') {
      // Stills come out of FFmpeg as PNG and are encoded by the image engine.
      const still = out.group === 'image' && out.id !== 'frames';
      const settings = avSettings(
        out.id === 'contact-sheet' ? out.id : still ? 'png' : input.targetId,
        input.options,
      );
      const track = <T>(next: Task<T>): Promise<T> => {
        if (cancelled) {
          next.cancel();
          throw abort();
        }
        task = next;
        input.onTask(next.id);
        return next.result;
      };
      const media = await runAv(input, settings, track, () => cancelled);
      if (!still || out.id === 'png') return media;
      const frame = new File([media.blob], 'frame.png', { type: 'image/png' });
      const frameInput: JobInput = {
        ...input,
        file: frame,
        inspection: { sniffed: { format: 'png', kind: 'image', label: 'PNG image' }, pages: 1 },
        edit: null,
      };
      const imageTarget = out.id === 'contact-sheet' ? 'jpeg' : input.targetId;
      const dirs = await imageEngines(frameInput.inspection, imageTarget);
      if (cancelled) throw abort();
      const image = await track(submitImage({ ...frameInput, targetId: imageTarget }, out, dirs));
      return {
        ...image,
        name: outputName(input.file.name, out.ext),
        notes: [...media.notes, ...image.notes],
      };
    }
    throw new Error(
      `Converting ${input.inspection.sniffed.label} to ${out.label} isn't available yet`,
    );
  })();
  return {
    result,
    cancel() {
      cancelled = true;
      task?.cancel();
    },
  };
}

async function imageEngines(inspection: Inspection, targetId: string) {
  const plan = planImage(
    { format: inspection.sniffed.format ?? '', pages: inspection.pages },
    targetId,
  );
  const needsMagick =
    plan.decoder === 'magick' || plan.encoder === 'magick' || inspection.sniffed.format === 'icns';
  const [vips, magick] = await Promise.all([
    downloads.ensure('vips'),
    needsMagick ? downloads.ensure('magick') : Promise.resolve(undefined),
  ]);
  return { vips, magick };
}

export function imageSettings(
  targetId: string,
  options: ConvertOptions,
  edit: ImageEdit | null = null,
): ImageSettings {
  return {
    edit,
    target: targetId,
    quality: options.quality,
    lossless: options.lossless,
    maxEdge: options.maxEdge,
    background: options.background,
    metadata: options.metadata,
    targetBytes: options.targetMb ? Math.floor(options.targetMb * 1_000_000) : null,
    gifThreshold: options.gifThreshold,
    hotspot: { x: options.hotspotX, y: options.hotspotY },
    maskableBackground: options.maskableBackground,
    keepHdr: options.keepHdr,
  };
}

function submitImage(
  input: JobInput,
  out: Target,
  dirs: { vips: string; magick?: string },
): Task<Output> {
  const { inspection, file } = input;
  const pixels = (inspection.width ?? 4000) * (inspection.height ?? 3000) * inspection.pages;
  const memory = 160 * 1024 * 1024 + Math.min(pixels * 16, 2 * 1024 ** 3) + file.size * 2;
  const settings = imageSettings(input.targetId, input.options, input.edit ?? null);
  return scheduler.submit({
    pool: imagePool,
    slots: input.threads,
    memory,
    units: file.size,
    run: async (api, jobId) => {
      const result = await api.convert(
        jobId,
        {
          file,
          format: inspection.sniffed.format ?? '',
          pages: inspection.pages,
          dirs,
          threads: input.threads,
        },
        settings,
      );
      return {
        blob: new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: out.mime }),
        name: outputName(file.name, out.ext),
        notes: result.notes,
        width: result.width,
        height: result.height,
        quality: result.quality,
      };
    },
  });
}

export function outputName(name: string, ext: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}.${ext}`;
}

export function avSettings(targetId: string, options: ConvertOptions): AvSettings {
  const changed = (keys: (keyof ConvertOptions)[]) =>
    keys.some((key) => options[key] !== DEFAULT_OPTIONS[key]);
  return {
    target: targetId,
    quality: options.quality,
    height: options.height,
    fps: options.fps,
    removeAudio: options.removeAudio,
    audioKbps: options.audioKbps,
    sampleRate: options.sampleRate,
    channels: options.channels,
    videoCodec: options.videoCodec,
    targetBytes: options.targetMb ? Math.floor(options.targetMb * 1_000_000) : null,
    metadata: options.metadata,
    trimStart: options.trimStart,
    trimEnd: options.trimEnd,
    gif: {
      fps: options.gifFps,
      width: options.gifWidth,
      dither: options.gifDither,
      palette: options.gifPalette,
    },
    allowCopy: !changed([
      'quality',
      'height',
      'fps',
      'videoCodec',
      'targetMb',
      'audioKbps',
      'sampleRate',
      'channels',
    ]),
  };
}

const MB = 1024 * 1024;

async function runAv(
  input: JobInput,
  settings: AvSettings,
  track: <T>(task: Task<T>) => Promise<T>,
  cancelled: () => boolean,
): Promise<Output> {
  const { file, inspection } = input;
  const out = target(settings.target);
  const probe = inspection.av;
  let route: Route = routeAv(probe, settings);
  const submit = (ffmpegDir: string | undefined) =>
    scheduler.submit({
      pool: avPool,
      slots: 1,
      memory: (route === 'ffmpeg' ? 700 : 300) * MB + Math.min(file.size, 1024 * MB),
      units: file.size,
      run: async (api, jobId): Promise<Output | { needsFfmpeg: string }> => {
        const result = await api.convert(jobId, { file, probe, route, ffmpegDir }, settings);
        if (result.kind === 'needs-ffmpeg') return { needsFfmpeg: result.reason };
        return {
          blob: new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: out.mime }),
          name: outputName(file.name, out.ext),
          notes: result.notes,
        };
      },
    });
  let ffmpegDir = route === 'ffmpeg' ? await downloads.ensure('ffmpeg') : undefined;
  if (cancelled()) throw new DOMException('Cancelled', 'AbortError');
  const first = await track(submit(ffmpegDir));
  if (!('needsFfmpeg' in first)) return first;
  route = 'ffmpeg';
  ffmpegDir = await downloads.ensure('ffmpeg');
  if (cancelled()) throw new DOMException('Cancelled', 'AbortError');
  const second = await track(submit(ffmpegDir));
  if ('needsFfmpeg' in second) throw new Error("This file can't be converted to that format");
  return second;
}
