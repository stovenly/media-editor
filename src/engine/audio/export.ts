// Renders an audio project and encodes it as it goes. Runs in the audio worker.
import { AudioSample, AudioSampleSource, BufferTarget, canEncodeAudio, Output } from 'mediabunny';
import { projectDuration, type AudioProject } from '../../project/audio';
import { audioBitrate, NATIVE_TARGETS, RINGTONE_SECONDS } from '../av/plan';
import { outputFormat, registerEncoders } from '../av/native';
import { framesOf } from './dsp';
import { analyse, normalizeGain, renderMix } from './render';
import type { AssetHandle } from './source';

export type AudioExportSettings = {
  target: string;
  quality: number; // 1..100
  kbps: number | null;
  targetBytes: number | null;
};

// `intermediate` means the bytes are WAV and still need converting to `target` by FFmpeg.
export type AudioExportResult = {
  bytes: Uint8Array;
  notes: string[];
  intermediate: boolean;
  duration: number;
};

const LOSSLESS = new Set(['wav', 'flac']);

export function exportRange(project: AudioProject): { from: number; to: number } {
  return { from: 0, to: projectDuration(project) };
}

export async function exportProject(
  project: AudioProject,
  assets: ReadonlyMap<string, AssetHandle>,
  settings: AudioExportSettings,
  onProgress: (fraction: number) => void,
): Promise<AudioExportResult> {
  await registerEncoders();
  const notes: string[] = [];
  let { from, to } = exportRange(project);
  let gain = 1;
  const analysing = project.normalize.mode !== 'off' || project.trimSilence;
  if (analysing) {
    const analysis = await analyse(project, assets, to, (f) => onProgress(f * 0.4));
    gain = normalizeGain(project, analysis);
    if (project.trimSilence) {
      from = Math.max(from, analysis.firstSound - 0.05);
      to = Math.min(to, analysis.lastSound + 0.05);
      notes.push('Silence trimmed from the start and end');
    }
    if (project.normalize.mode !== 'off')
      notes.push(`Volume changed by ${(20 * Math.log10(gain)).toFixed(1)} dB`);
  }
  if (settings.target === 'm4r' && (to - from) / project.speed > RINGTONE_SECONDS) {
    to = from + RINGTONE_SECONDS * project.speed;
    notes.push('Cut to 40 seconds, the longest an iPhone ringtone can be');
  }
  const duration = Math.max(0.001, (to - from) / project.speed);

  const native = NATIVE_TARGETS[settings.target];
  // Without an encoder here, a WAV is rendered and the converter (which can fall back to FFmpeg) finishes it.
  const intermediate =
    !native || native.video !== undefined || !(await canEncodeAudio(native.audio));
  const spec = intermediate ? NATIVE_TARGETS.wav! : native;
  let bitrate: number | undefined;
  if (!LOSSLESS.has(spec.container)) {
    bitrate = settings.targetBytes
      ? Math.max(16_000, Math.floor((settings.targetBytes * 8 * 0.97) / duration))
      : settings.kbps
        ? settings.kbps * 1000
        : audioBitrate(settings.quality, project.channels);
  }

  const target = new BufferTarget();
  const output = new Output({
    format: outputFormat(spec.container, ((bitrate ?? 1_411_200) * duration) / 8),
    target,
  });
  const source = new AudioSampleSource({ codec: spec.audio, bitrate });
  output.addAudioTrack(source);
  await output.start();

  const base = analysing ? 0.4 : 0;
  let written = 0;
  for await (const block of renderMix(project, assets, { from, to, gain })) {
    const frames = framesOf(block);
    const data = new Float32Array(frames * block.length);
    block.forEach((plane, c) => data.set(plane, c * frames));
    const sample = new AudioSample({
      data,
      format: 'f32-planar',
      numberOfChannels: block.length,
      sampleRate: project.sampleRate,
      timestamp: written / project.sampleRate,
    });
    await source.add(sample);
    sample.close();
    written += frames;
    onProgress(base + (1 - base) * Math.min(0.99, written / project.sampleRate / duration));
  }
  source.close();
  await output.finalize();
  if (!target.buffer) throw new Error('The export produced no output');
  onProgress(1);
  return { bytes: new Uint8Array(target.buffer), notes, intermediate, duration };
}
