// Mixes an audio project block by block. Memory stays bounded however long the timeline is.
import { clipEnd, clipLength, type AudioClip, type AudioProject } from '../../project/audio';
import {
  applyChannelOp,
  fadeCurve,
  framesOf,
  LoudnessMeter,
  silence,
  TimeStretch,
  type Planar,
} from './dsp';
import { SourceReader, type AssetHandle } from './source';

export const BLOCK_FRAMES = 8192;

export type RenderRange = { from: number; to: number; gain: number };

type Reader = { read(frames: number): Promise<Planar>; close(): void };

type Active = { reader: Reader; clip: AudioClip };

const DUCK_GAIN = 0.25;

// Reads a clip faster or slower than real time, time-stretched so the pitch stays put.
class StretchedReader implements Reader {
  private stretch: TimeStretch;
  private fifo: Planar;

  constructor(
    private readonly source: SourceReader,
    rate: number,
    private readonly channels: number,
    speed: number,
  ) {
    this.stretch = new TimeStretch(rate, channels, speed);
    this.fifo = silence(channels, 0);
  }

  async read(frames: number): Promise<Planar> {
    while (framesOf(this.fifo) < frames) {
      const out = this.stretch.process(await this.source.read(BLOCK_FRAMES));
      this.fifo = this.fifo.map((buf, c) => {
        const joined = new Float32Array(buf.length + out[c]!.length);
        joined.set(buf);
        joined.set(out[c]!, buf.length);
        return joined;
      });
    }
    const block = this.fifo.map((buf) => buf.slice(0, frames));
    this.fifo = this.fifo.map((buf) => buf.subarray(frames));
    return block;
  }

  close(): void {
    this.source.close();
  }
}

// Yields mixed, channel-processed, gain-adjusted and time-stretched blocks for [from, to) on the timeline.
export async function* renderMix(
  project: AudioProject,
  assets: ReadonlyMap<string, AssetHandle>,
  range: RenderRange,
): AsyncGenerator<Planar> {
  const rate = project.sampleRate;
  const channels = project.channels;
  const stretch = new TimeStretch(rate, channels, project.speed);
  const active = new Map<string, Active>();
  const totalFrames = Math.max(0, Math.round((range.to - range.from) * rate));
  try {
    for (let done = 0; done < totalFrames; done += BLOCK_FRAMES) {
      const frames = Math.min(BLOCK_FRAMES, totalFrames - done);
      const t0 = range.from + done / rate;
      const t1 = t0 + frames / rate;
      const mix = silence(channels, frames);
      const sounding = project.tracks.some(
        (t) => !t.muted && !t.duck && t.clips.some((c) => clipEnd(c) > t0 && c.start < t1),
      );
      for (const track of project.tracks) {
        if (track.muted) continue;
        const duck = track.duck && sounding ? DUCK_GAIN : 1;
        for (const clip of track.clips) {
          if (clipEnd(clip) <= t0 || clip.start >= t1) continue;
          let entry = active.get(clip.id);
          if (!entry) {
            const asset = assets.get(clip.assetId);
            if (!asset) continue;
            const speed = clip.speed ?? 1;
            const from = clip.in + Math.max(0, t0 - clip.start) * speed;
            const source = new SourceReader(asset, from, rate, channels);
            entry = {
              reader: speed === 1 ? source : new StretchedReader(source, rate, channels, speed),
              clip,
            };
            active.set(clip.id, entry);
          }
          const offset = Math.max(0, Math.round((clip.start - t0) * rate));
          const until = Math.min(frames, Math.round((clipEnd(clip) - t0) * rate));
          if (until <= offset) continue;
          const block = await entry.reader.read(until - offset);
          mixInto(mix, block, offset, t0, rate, clip, track.gain * range.gain * duck);
        }
      }
      for (const [id, entry] of active) {
        if (clipEnd(entry.clip) <= t1) {
          entry.reader.close();
          active.delete(id);
        }
      }
      const processed = applyChannelOp(mix, project.channelOp);
      const out = stretch.process(processed, done + frames >= totalFrames);
      if (framesOf(out) > 0) yield out;
    }
  } finally {
    for (const entry of active.values()) entry.reader.close();
  }
}

function mixInto(
  mix: Planar,
  block: Planar,
  offset: number,
  t0: number,
  rate: number,
  clip: AudioClip,
  gain: number,
): void {
  const length = clipLength(clip);
  const frames = framesOf(block);
  for (let i = 0; i < frames; i++) {
    const local = t0 + (offset + i) / rate - clip.start;
    let envelope = clip.gain * gain;
    if (clip.fadeIn > 0 && local < clip.fadeIn) envelope *= fadeCurve(local / clip.fadeIn);
    if (clip.fadeOut > 0 && local > length - clip.fadeOut)
      envelope *= fadeCurve((length - local) / clip.fadeOut);
    for (let c = 0; c < mix.length; c++) mix[c]![offset + i]! += block[c]![i]! * envelope;
  }
}

export type Analysis = { peak: number; lufs: number; firstSound: number; lastSound: number };

const SILENCE_THRESHOLD = 10 ** (-50 / 20);

// One full pass for normalising and silence trimming. Times are on the timeline, before any speed change.
export async function analyse(
  project: AudioProject,
  assets: ReadonlyMap<string, AssetHandle>,
  to: number,
  onProgress: (fraction: number) => void,
): Promise<Analysis> {
  const meter = new LoudnessMeter(project.sampleRate, project.channels);
  const flat = { ...project, speed: 1 };
  let frame = 0;
  let first = -1;
  let last = -1;
  for await (const block of renderMix(flat, assets, { from: 0, to, gain: 1 })) {
    meter.add(block);
    const frames = framesOf(block);
    for (let i = 0; i < frames; i++) {
      let loud = false;
      for (const plane of block) if (Math.abs(plane[i]!) > SILENCE_THRESHOLD) loud = true;
      if (loud) {
        if (first < 0) first = frame + i;
        last = frame + i;
      }
    }
    frame += frames;
    onProgress(frame / project.sampleRate / Math.max(to, 0.001));
  }
  return {
    peak: meter.peak,
    lufs: meter.integrated,
    firstSound: first < 0 ? 0 : first / project.sampleRate,
    lastSound: last < 0 ? to : (last + 1) / project.sampleRate,
  };
}

export function normalizeGain(project: AudioProject, analysis: Analysis): number {
  const n = project.normalize;
  if (n.mode === 'peak' && analysis.peak > 0) return 10 ** (n.db / 20) / analysis.peak;
  if (n.mode === 'lufs' && Number.isFinite(analysis.lufs)) {
    const gain = 10 ** ((n.target - analysis.lufs) / 20);
    // Never push the sample peak past -1 dBFS while matching loudness.
    return Math.min(gain, analysis.peak > 0 ? 10 ** (-1 / 20) / analysis.peak : gain);
  }
  return 1;
}
