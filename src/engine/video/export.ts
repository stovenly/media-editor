// Renders a video project frame by frame through the compositor and encodes it with its mixed sound.
import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  canEncodeVideo,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from 'mediabunny';
import { soundOf } from '../../project/video-audio';
import { videoDuration, type VideoAsset, type VideoProject } from '../../project/video';
import { framesOf } from '../audio/dsp';
import { renderMix } from '../audio/render';
import type { AssetHandle } from '../audio/source';
import { registerEncoders } from '../av/native';
import { videoBitrate } from '../av/plan';
import { Compositor, type FrameLookup } from './compositor';

export type VideoExportSettings = {
  container: 'mp4' | 'webm';
  quality: number; // 1..100
  targetBytes: number | null;
  codec: 'avc' | 'hevc' | 'vp9' | 'av1' | null;
};

const AUDIO_BITRATE = 160_000;
const AUDIO_AHEAD = 1; // seconds of audio kept queued ahead of the video

export async function exportVideo(
  project: VideoProject,
  assets: ReadonlyMap<string, VideoAsset>,
  audio: ReadonlyMap<string, AssetHandle>,
  frames: FrameLookup,
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
  let bitrate = videoBitrate(width, height, fps, settings.quality, codec);
  if (settings.targetBytes) {
    bitrate = Math.max(
      100_000,
      Math.floor((settings.targetBytes * 8 * 0.94) / duration - audioBits),
    );
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const compositor = new Compositor(ctx);
  const target = new BufferTarget();
  const output = new Output({
    format:
      settings.container === 'mp4'
        ? new Mp4OutputFormat({ fastStart: 'in-memory' })
        : new WebMOutputFormat(),
    target,
  });
  const video = new CanvasSource(canvas, { codec, bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: fps });
  const audioSource = hasSound
    ? new AudioSampleSource({
        codec: settings.container === 'mp4' ? 'aac' : 'opus',
        bitrate: AUDIO_BITRATE,
      })
    : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();

  const mix = hasSound ? renderMix(sound, audio, { from: 0, to: duration, gain: 1 }) : null;
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

  for (let i = 0; i < totalFrames; i++) {
    const t = i / fps;
    await pumpAudio(t + AUDIO_AHEAD);
    await compositor.draw(project, t, frames, 1);
    await video.add(t, 1 / fps);
    onProgress(Math.min(0.99, (i + 1) / totalFrames));
  }
  await pumpAudio(Infinity);
  video.close();
  audioSource?.close();
  await output.finalize();
  if (!target.buffer) throw new Error('The export produced no output');
  if (settings.targetBytes && target.buffer.byteLength > settings.targetBytes)
    notes.push("Couldn't get under the target size");
  onProgress(1);
  return { bytes: new Uint8Array(target.buffer), notes };
}
