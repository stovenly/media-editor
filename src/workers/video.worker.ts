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

type Reader = { frames: Promise<VideoFrames | null>; use: string | null; frame: number };
type Readers = Reader[];

type Entry = {
  info: VideoAsset;
  file: File;
  frames: VideoFrames | null;
  readers: Readers; // preview decoders; the first wraps `frames`
  still: Drawable | null;
  audio: AssetHandle | null;
};

const entries = new Map<string, Entry>();
let canvas: OffscreenCanvas | null = null;
let compositor: Compositor | null = null;
const back = new OffscreenCanvas(1, 1);
let playing = 0;

// A use keeps its decoder while it stays on screen; a decoder idle this frame is handed to a new use, and
// another is opened only when every decoder is busy this frame.
function lookup(readersOf: (entry: Entry) => Readers | undefined): FrameLookup {
  let frame = 0;
  const find = async (assetId: string, time: number, use: string) => {
    const entry = entries.get(assetId);
    if (!entry) return null;
    if (entry.still) return entry.still;
    const readers = readersOf(entry);
    if (!readers?.length) return null;
    let reader = readers.find((r) => r.use === use) ?? readers.find((r) => r.frame < frame);
    if (!reader) {
      reader = { frames: VideoFrames.open(entry.file).catch(() => null), use, frame };
      readers.push(reader);
    }
    reader.use = use;
    reader.frame = frame;
    return (await (await reader.frames)?.at(time)) ?? null;
  };
  return Object.assign(find, { begin: () => void frame++ });
}

const reader = (frames: VideoFrames | null): Reader => ({
  frames: Promise.resolve(frames),
  use: null,
  frame: -1,
});

const preview = lookup((entry) => entry.readers);

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
  if (back.width !== width || back.height !== height) {
    back.width = width;
    back.height = height;
  }
  await compositor.draw(project, time, preview, scale);
  // The visible canvas changes only here, in one step, so a slow frame never shows half drawn.
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  canvas.getContext('2d')!.drawImage(back, 0, 0);
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
          const probe = frames ? await probeVideo(file) : null;
          const info: VideoAsset = {
            id,
            name,
            kind,
            duration: probe?.duration ?? audio?.duration ?? 0,
            fps: probe?.fps ?? 0,
            bitrate: probe?.bitrate ?? 0,
            width: first ? (sideways ? first.height : first.width) : 0,
            height: first ? (sideways ? first.width : first.height) : 0,
            hasAudio: Boolean(audio),
            hasVideo: Boolean(first),
          };
          if (kind === 'video' && !frames) throw new Error(`${file.name} can't be decoded here`);
          entries.set(id, {
            info,
            file,
            frames,
            readers: frames ? [reader(frames)] : [],
            still,
            audio,
          });
          return info;
        }),
      );
    } catch (error) {
      throw new Error(messageOf(error), { cause: error });
    }
  },

  setCanvas(offscreen: OffscreenCanvas): void {
    canvas = offscreen;
    compositor = new Compositor(back.getContext('2d', { alpha: false })!, fonts);
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
  // Source time where the frame shown at `time` begins, or null when the asset has no video frames.
  async frameStart(assetId: string, time: number): Promise<number | null> {
    const entry = entries.get(assetId);
    if (!entry?.frames) return null;
    return entry.frames.startOf(time);
  },

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
  ): Promise<{ bytes: Uint8Array; notes: string[]; container: 'mp4' | 'webm' } | null> {
    try {
      const infos = new Map([...entries].map(([id, e]) => [id, e.info]));
      const cuts = copyableCuts(project, infos);
      const entry = cuts && entries.get(cuts.assetId);
      if (!cuts || !entry) throw new Error('This edit needs a full export');
      const result = await copyCuts(entry.file, cuts.ranges, preferred, (f) =>
        reportProgress(jobId, f),
      );
      return result && Comlink.transfer(result, [result.bytes.buffer as ArrayBuffer]);
    } catch (error) {
      throw new Error(messageOf(error), { cause: error });
    }
  },

  async export(
    jobId: string,
    project: VideoProject,
    settings: VideoExportSettings,
  ): Promise<{ bytes: Uint8Array; notes: string[] }> {
    const exporting = new Map<string, Readers>();
    try {
      const frames = lookup((entry) => exporting.get(entry.info.id));
      for (const entry of entries.values()) {
        if (entry.info.kind === 'video') {
          const opened = await VideoFrames.open(entry.file);
          if (opened) exporting.set(entry.info.id, [reader(opened)]);
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
      for (const readers of exporting.values())
        for (const r of readers) void r.frames.then((frames) => frames?.close());
    }
  },
};

async function probeVideo(file: File): Promise<{ duration: number; fps: number; bitrate: number }> {
  const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const duration = await input.computeDuration();
    const track = await input.getPrimaryVideoTrack();
    const stats = track ? await track.computePacketStats() : null;
    return { duration, fps: stats?.averagePacketRate ?? 0, bitrate: stats?.averageBitrate ?? 0 };
  } finally {
    input.dispose();
  }
}

export type VideoApi = typeof api;

Comlink.expose(api);
