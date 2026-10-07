// One video editing session: media, the preview canvas, playback locked to the audio clock, and export.
import * as Comlink from 'comlink';
import {
  bufferedFrames,
  framesRead,
  ringState,
  STATE_ENDED,
  type Ring,
} from '../engine/audio/ring';
import { openAsset, type AssetHandle } from '../engine/audio/source';
import { messageOf } from '../engine/errors';
import { Compositor, type FontLoader, type FrameLookup } from '../engine/video/compositor';
import { BUNDLED_FONTS } from '../engine/video/fonts';
import { copyCuts } from '../engine/video/copy-export';
import { exportVideo, type VideoExportSettings } from '../engine/video/export';
import { stillImage, VideoFrames, type Drawable } from '../engine/video/frames';
import { copyableCuts, type AssetKind, type VideoAsset, type VideoProject } from '../project/video';
import { attachProgress, reportProgress } from './progress';

type Entry = {
  info: VideoAsset;
  file: File;
  frames: VideoFrames | null;
  still: Drawable | null;
  audio: AssetHandle | null;
};

const entries = new Map<string, Entry>();
let canvas: OffscreenCanvas | null = null;
let compositor: Compositor | null = null;
let playing = 0;

function lookup(frames: (entry: Entry) => VideoFrames | null): FrameLookup {
  return async (assetId, time) => {
    const entry = entries.get(assetId);
    if (!entry) return null;
    if (entry.still) return entry.still;
    return (await frames(entry)?.at(time)) ?? null;
  };
}

const preview = lookup((entry) => entry.frames);

const fontLoads = new Map<string, Promise<void>>();

function loadBundled(family: string): Promise<void> {
  const font = BUNDLED_FONTS.find((f) => f.family === family);
  const loading = font
    ? Promise.all(
        font.faces.map((face) => {
          const fontFace = new FontFace(family, `url(${face.url})`, {
            style: face.style,
            weight: face.weight,
          });
          self.fonts.add(fontFace);
          return fontFace.load();
        }),
      ).then(() => {})
    : Promise.resolve();
  fontLoads.set(family, loading);
  return loading;
}

// A font that fails to load falls back to sans-serif rather than stopping the render.
const fonts: FontLoader = async (families) => {
  await Promise.all(
    [...families].map((family) => (fontLoads.get(family) ?? loadBundled(family)).catch(() => {})),
  );
};

async function draw(project: VideoProject, time: number, maxEdge: number): Promise<void> {
  if (!canvas || !compositor) return;
  const scale = Math.min(1, maxEdge / Math.max(project.width, project.height));
  const width = Math.round(project.width * scale);
  const height = Math.round(project.height * scale);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  await compositor.draw(project, time, preview, scale);
}

const api = {
  attach: attachProgress,

  async open(
    list: { id: string; file: File; kind: AssetKind; name: string }[],
  ): Promise<VideoAsset[]> {
    try {
      return await Promise.all(
        list.map(async ({ id, file, kind, name }) => {
          const known = entries.get(id);
          if (known) return known.info;
          let frames: VideoFrames | null = null;
          let still: Drawable | null = null;
          let audio: AssetHandle | null = null;
          if (kind === 'image') still = await stillImage(file);
          if (kind === 'video') frames = await VideoFrames.open(file);
          if (kind !== 'image') audio = await openAsset(file).catch(() => null);
          const first = still ?? (frames ? await frames.at(0) : null);
          const sideways = first && (first.rotation === 90 || first.rotation === 270);
          const info: VideoAsset = {
            id,
            name,
            kind,
            duration: frames ? await durationOf(file) : (audio?.duration ?? 0),
            width: first ? (sideways ? first.height : first.width) : 0,
            height: first ? (sideways ? first.width : first.height) : 0,
            hasAudio: Boolean(audio),
            hasVideo: Boolean(first),
          };
          if (kind === 'video' && !frames) throw new Error(`${file.name} can't be decoded here`);
          entries.set(id, { info, file, frames, still, audio });
          return info;
        }),
      );
    } catch (error) {
      throw new Error(messageOf(error), { cause: error });
    }
  },

  setCanvas(offscreen: OffscreenCanvas): void {
    canvas = offscreen;
    compositor = new Compositor(offscreen.getContext('2d', { alpha: false })!, fonts);
  },

  async loadFont(family: string, bytes: ArrayBuffer): Promise<void> {
    const face = new FontFace(family, bytes);
    const loading = face.load().then((loaded) => {
      self.fonts.add(loaded);
    });
    fontLoads.set(family, loading);
    try {
      await loading;
    } catch {
      fontLoads.delete(family);
      throw new Error("This font file can't be used");
    }
  },

  // A full-resolution frame, drawn exactly as the export draws it.
  async snapshot(project: VideoProject, time: number): Promise<Blob> {
    const full = new OffscreenCanvas(project.width, project.height);
    await new Compositor(full.getContext('2d', { alpha: false })!, fonts).draw(
      project,
      time,
      preview,
      1,
    );
    return full.convertToBlob({ type: 'image/png' });
  },

  async render(project: VideoProject, time: number, maxEdge: number): Promise<void> {
    await draw(project, time, maxEdge);
  },

  // Draws whichever frame matches the audio clock until stopped or the audio ends.
  async play(
    project: VideoProject,
    from: number,
    ring: Ring,
    rate: number,
    maxEdge: number,
  ): Promise<void> {
    const session = ++playing;
    let last = -1;
    while (session === playing) {
      const time = from + framesRead(ring) / rate;
      const frame = Math.floor(time * project.fps);
      if (frame !== last) {
        last = frame;
        await draw(project, time, maxEdge);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 4));
      }
      if (ringState(ring) === STATE_ENDED && bufferedFrames(ring) === 0) break;
    }
  },

  stop(): void {
    playing += 1;
  },

  async exportCopy(
    jobId: string,
    project: VideoProject,
    preferred: 'mp4' | 'webm',
  ): Promise<{ bytes: Uint8Array; notes: string[]; container: 'mp4' | 'webm' }> {
    try {
      const infos = new Map([...entries].map(([id, e]) => [id, e.info]));
      const cuts = copyableCuts(project, infos);
      const entry = cuts && entries.get(cuts.assetId);
      if (!cuts || !entry) throw new Error('This edit needs a full export');
      const result = await copyCuts(entry.file, cuts.ranges, preferred, (f) =>
        reportProgress(jobId, f),
      );
      return Comlink.transfer(result, [result.bytes.buffer as ArrayBuffer]);
    } catch (error) {
      throw new Error(messageOf(error), { cause: error });
    }
  },

  async export(
    jobId: string,
    project: VideoProject,
    settings: VideoExportSettings,
  ): Promise<{ bytes: Uint8Array; notes: string[] }> {
    const exporting = new Map<string, VideoFrames>();
    try {
      const frames = lookup((entry) => exporting.get(entry.info.id) ?? null);
      for (const entry of entries.values()) {
        if (entry.info.kind === 'video') {
          const reader = await VideoFrames.open(entry.file);
          if (reader) exporting.set(entry.info.id, reader);
        }
      }
      const infos = new Map([...entries].map(([id, e]) => [id, e.info]));
      const audio = new Map(
        [...entries].flatMap(([id, e]) => (e.audio ? [[id, e.audio] as const] : [])),
      );
      const result = await exportVideo(project, infos, audio, frames, fonts, settings, (f) =>
        reportProgress(jobId, f),
      );
      return Comlink.transfer(result, [result.bytes.buffer as ArrayBuffer]);
    } catch (error) {
      throw new Error(messageOf(error), { cause: error });
    } finally {
      for (const reader of exporting.values()) reader.close();
    }
  },
};

async function durationOf(file: File): Promise<number> {
  const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    return await input.computeDuration();
  } finally {
    input.dispose();
  }
}

export type VideoApi = typeof api;

Comlink.expose(api);
