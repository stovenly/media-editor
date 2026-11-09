// Renders a video project frame by frame through the compositor and encodes it with its mixed sound.
import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  canEncodeVideo,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
} from 'mediabunny';
import { soundOf } from '../../project/video-audio';
import {
  sourceBitsPerPixel,
  videoDuration,
  type VideoAsset,
  type VideoProject,
} from '../../project/video';
import { framesOf } from '../audio/dsp';
import { renderMix } from '../audio/render';
import type { AssetHandle } from '../audio/source';
import { registerEncoders } from '../av/native';
import { videoBitrate } from '../av/plan';
import { Compositor, type FontLoader, type FrameLookup } from './compositor';

export type VideoExportSettings = {
  container: 'mp4' | 'webm';
  quality: number; // 1..100
  targetBytes: number | null;
  codec: 'avc' | 'hevc' | 'vp9' | 'av1' | null;
};

const AUDIO_BITRATE = 160_000;
const AUDIO_AHEAD = 1; // seconds of audio kept queued ahead of the video
// A fixed-quality encode at these quantizers looks like its source; lower is better.
const QUANTIZER: Partial<Record<string, number>> = { avc: 18, hevc: 20, vp9: 24, av1: 90 };
const SHORTFALL = 0.8; // fraction of the asked-for video bitrate that counts as delivered
const MAX_OVERSHOOT = 4; // cap on a raised request, as a multiple of the target
const SAMPLE_SECONDS = 2;
const SAMPLE_ROUNDS = 3;
const SAMPLE_SHARE = 0.1; // of the progress bar

export async function exportVideo(
  project: VideoProject,
  assets: ReadonlyMap<string, VideoAsset>,
  audio: ReadonlyMap<string, AssetHandle>,
  frames: FrameLookup,
  fonts: FontLoader,
  settings: VideoExportSettings,
  onProgress: (fraction: number) => void,
): Promise<{ bytes: Uint8Array; notes: string[] }> {
  await registerEncoders();
  const notes: string[] = [];
  const { width, height, fps } = project;
  const duration = videoDuration(project);
  if (duration <= 0) throw new Error('The timeline is empty');
  const totalFrames = Math.max(1, Math.round(duration * fps));
  const sound = soundOf(project, assets);
  const hasSound = sound.tracks.some((t) => t.clips.length > 0);

  const candidates = settings.codec
    ? [settings.codec]
    : settings.container === 'mp4'
      ? (['avc', 'hevc'] as const)
      : (['vp9', 'vp8', 'av1'] as const);
  let codec: (typeof candidates)[number] | null = null;
  for (const c of candidates) {
    if (await canEncodeVideo(c, { width, height })) {
      codec = c;
      break;
    }
  }
  if (!codec)
    throw new Error(
      `This browser can't encode ${settings.container.toUpperCase()} video at ${width}×${height}`,
    );

  const audioBits = hasSound ? AUDIO_BITRATE : 0;
  let bitrate = videoBitrate(
    width,
    height,
    fps,
    settings.quality,
    codec,
    sourceBitsPerPixel(project, assets),
  );
  if (settings.targetBytes) {
    bitrate = Math.max(
      100_000,
      Math.floor((settings.targetBytes * 8 * 0.94) / duration - audioBits),
    );
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const compositor = new Compositor(ctx, fonts);
  const constantOk = (rate: number) =>
    canEncodeVideo(codec, {
      width,
      height,
      quality: new Quality({ bitrate: rate, bitrateMode: 'constant' }),
    });

  // Renders frames [first, first + count) from timeline time first / fps; the output starts at 0.
  const encode = async (
    quality: Quality,
    first: number,
    count: number,
    withSound: boolean,
    report: (fraction: number) => void,
  ) => {
    const from = first / fps;
    const seconds = count / fps;
    let videoBytes = 0;
    let mode: string | undefined;
    const target = new BufferTarget();
    const output = new Output({
      format:
        settings.container === 'mp4'
          ? new Mp4OutputFormat({ fastStart: 'in-memory' })
          : new WebMOutputFormat(),
      target,
    });
    const video = new CanvasSource(canvas, {
      codec,
      quality,
      keyFrameInterval: 2,
      // Called once per candidate config in order; the last call is the one in use.
      onEncoderConfig: (config) => (mode = config.bitrateMode),
      onEncodedPacket: (packet) => (videoBytes += packet.byteLength),
    });
    output.addVideoTrack(video, { frameRate: fps });
    const audioSource = withSound
      ? new AudioSampleSource({
          codec: settings.container === 'mp4' ? 'aac' : 'opus',
          bitrate: AUDIO_BITRATE,
        })
      : null;
    if (audioSource) output.addAudioTrack(audioSource);
    await output.start();

    const mix = withSound
      ? renderMix(sound, audio, { from, to: from + seconds, gain: 1 })
      : null;
    let audioTime = 0;
    const pumpAudio = async (until: number) => {
      if (!mix || !audioSource) return;
      while (audioTime < until) {
        const next = await mix.next();
        if (next.done) {
          audioTime = Infinity;
          return;
        }
        const block = next.value;
        const n = framesOf(block);
        const data = new Float32Array(n * block.length);
        block.forEach((plane, c) => data.set(plane, c * n));
        const sample = new AudioSample({
          data,
          format: 'f32-planar',
          numberOfChannels: block.length,
          sampleRate: sound.sampleRate,
          timestamp: audioTime,
        });
        await audioSource.add(sample);
        sample.close();
        audioTime += n / sound.sampleRate;
      }
    };

    for (let i = 0; i < count; i++) {
      const t = i / fps;
      await pumpAudio(t + AUDIO_AHEAD);
      await compositor.draw(project, from + t, frames, 1);
      await video.add(t, 1 / fps);
      report((i + 1) / count);
    }
    await pumpAudio(Infinity);
    video.close();
    audioSource?.close();
    await output.finalize();
    if (!target.buffer) throw new Error('The export produced no output');
    return { buffer: target.buffer, achieved: (videoBytes * 8) / seconds, mode };
  };

  const quantizer = settings.targetBytes ? undefined : QUANTIZER[codec];
  const qualityAt = async (rate: number, withQuantizer: boolean) =>
    new Quality({
      ...(withQuantizer && quantizer !== undefined ? { quantizer } : {}),
      bitrate: rate,
      bitrateMode: (await constantOk(rate)) ? 'constant' : 'variable',
    });

  // Browser encoders ignore bitrate requests on calm footage, so a short sample from the middle is measured
  // and the request raised before the one full encode.
  const sampleCount = Math.min(totalFrames, Math.round(SAMPLE_SECONDS * fps));
  const sampleFirst = Math.floor((totalFrames - sampleCount) / 2);
  let request = bitrate;
  let raised = false;
  if (!settings.targetBytes) {
    for (let round = 0; round < SAMPLE_ROUNDS; round++) {
      const sample = await encode(
        await qualityAt(request, !raised),
        sampleFirst,
        sampleCount,
        false,
        (f) => onProgress(((round + f) / SAMPLE_ROUNDS) * SAMPLE_SHARE),
      );
      if (sample.achieved >= bitrate * SHORTFALL) break;
      const usedBitrate = sample.mode !== 'quantizer';
      request = Math.min(
        bitrate * MAX_OVERSHOOT,
        Math.round(usedBitrate ? (request * bitrate) / sample.achieved : request),
      );
      raised = true;
    }
  }
  const start = settings.targetBytes ? 0 : SAMPLE_SHARE;
  const result = await encode(await qualityAt(request, !raised), 0, totalFrames, hasSound, (f) =>
    onProgress(Math.min(0.99, start + (1 - start) * f)),
  );
  if (!settings.targetBytes && result.achieved < bitrate * SHORTFALL)
    notes.push(
      `This browser's encoder delivered ${(result.achieved / 1e6).toFixed(1)} Mbps of the ${(bitrate / 1e6).toFixed(1)} Mbps asked for, so quality may be lower than the source`,
    );
  if (settings.targetBytes && result.buffer.byteLength > settings.targetBytes)
    notes.push("Couldn't get under the target size");
  onProgress(1);
  return { bytes: new Uint8Array(result.buffer), notes };
}
