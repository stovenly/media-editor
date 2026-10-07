// WebCodecs transcodes and packet-copy remuxes through Mediabunny. Runs in a worker.
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  canEncodeAudio,
  canEncodeVideo,
  Conversion,
  FlacOutputFormat,
  Input,
  MkvOutputFormat,
  MovOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  WavOutputFormat,
  WebMOutputFormat,
  type ConversionOptions,
  type OutputFormat,
} from 'mediabunny';
import type { AvProbe } from '../../media/probe';
import {
  clipDuration,
  NATIVE_TARGETS,
  planBitrates,
  RINGTONE_SECONDS,
  type AvSettings,
  type NativeContainer,
} from './plan';

export class NeedsFfmpeg extends Error {
  override name = 'NeedsFfmpeg';
}

const IN_MEMORY_FAST_START_LIMIT = 500_000_000;
const VIDEO_CODECS = new Set(['avc', 'hevc', 'vp8', 'vp9', 'av1']);
const WEBM_CODECS = new Set(['vp8', 'vp9', 'av1']);

export function outputFormat(container: NativeContainer, expectedBytes: number): OutputFormat {
  switch (container) {
    case 'mp4':
      return new Mp4OutputFormat({
        fastStart: expectedBytes < IN_MEMORY_FAST_START_LIMIT ? 'in-memory' : false,
      });
    case 'mov':
      return new MovOutputFormat({
        fastStart: expectedBytes < IN_MEMORY_FAST_START_LIMIT ? 'in-memory' : false,
      });
    case 'mkv':
      return new MkvOutputFormat();
    case 'webm':
      return new WebMOutputFormat();
    case 'mp3':
      return new Mp3OutputFormat();
    case 'wav':
      return new WavOutputFormat();
    case 'flac':
      return new FlacOutputFormat();
    case 'ogg':
      return new OggOutputFormat();
  }
}

let registered: Promise<void> | undefined;

// WASM encoders for codecs a browser's WebCodecs lacks (MP3 and FLAC everywhere, AAC in Firefox).
export function registerEncoders(): Promise<void> {
  registered ??= (async () => {
    const [mp3, aac, flac] = await Promise.all([
      canEncodeAudio('mp3'),
      canEncodeAudio('aac'),
      canEncodeAudio('flac'),
    ]);
    if (!mp3) (await import('@mediabunny/mp3-encoder')).registerMp3Encoder();
    if (!aac) (await import('@mediabunny/aac-encoder')).registerAacEncoder();
    if (!flac) (await import('@mediabunny/flac-encoder')).registerFlacEncoder();
  })();
  return registered;
}

export type NativeResult = { bytes: Uint8Array; notes: string[] };

export async function convertNative(
  file: File,
  probe: AvProbe,
  settings: AvSettings,
  onProgress: (fraction: number) => void,
): Promise<NativeResult> {
  const spec = NATIVE_TARGETS[settings.target];
  if (!spec) throw new NeedsFfmpeg('No native container');
  await registerEncoders();

  const plan = planBitrates(probe, settings);
  const notes = [...plan.notes];
  const keepsVideo = Boolean(spec.video && probe.video);
  const keepsAudio = Boolean(probe.audio) && plan.audio !== null;
  let videoCodec = spec.video;
  if (keepsVideo && settings.videoCodec && VIDEO_CODECS.has(settings.videoCodec)) {
    const wanted = settings.videoCodec as NonNullable<typeof spec.video>;
    if (spec.container !== 'webm' || WEBM_CODECS.has(wanted)) videoCodec = wanted;
  }
  if (keepsVideo && videoCodec && plan.size) {
    const ok = await canEncodeVideo(videoCodec, {
      width: plan.size.width,
      height: plan.size.height,
      bitrate: plan.video ?? undefined,
    });
    if (!ok) throw new NeedsFfmpeg(`This browser can't encode ${videoCodec}`);
  }
  if (keepsAudio && !(await canEncodeAudio(spec.audio)))
    throw new NeedsFfmpeg(`This browser can't encode ${spec.audio}`);

  const duration = clipDuration(probe, settings);
  const start = settings.trimStart ?? undefined;
  let end = settings.trimEnd ?? undefined;
  if (settings.target === 'm4r' && duration < probe.duration - (start ?? 0)) {
    end = (start ?? 0) + RINGTONE_SECONDS;
    notes.push('Cut to 40 seconds, the longest an iPhone ringtone can be');
  }
  const sized = settings.targetBytes !== null;
  const keepsAlpha =
    Boolean(probe.video?.alpha) && (spec.container === 'webm' || spec.container === 'mkv');
  // Copied packets lose their alpha side data, so transparent video is always re-encoded.
  const transform = !settings.allowCopy || keepsAlpha;
  const lossless = spec.audio === 'pcm-s16' || spec.audio === 'flac';

  const run = async (videoBitrate: number | null): Promise<Uint8Array> => {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const target = new BufferTarget();
    const expected = (((videoBitrate ?? 0) + (plan.audio ?? 0)) * duration) / 8;
    const output = new Output({ format: outputFormat(spec.container, expected), target });
    const options: ConversionOptions = {
      input,
      output,
      tracks: 'primary',
      video: keepsVideo
        ? {
            codec: videoCodec,
            bitrate: videoBitrate ?? undefined,
            width: plan.size?.width,
            height: plan.size?.height,
            fit: 'fill',
            frameRate: settings.fps ?? undefined,
            alpha: keepsAlpha ? 'keep' : 'discard',
            forceTranscode: transform,
          }
        : { discard: true },
      audio: keepsAudio
        ? {
            codec: spec.audio,
            bitrate: lossless ? undefined : (plan.audio ?? undefined),
            numberOfChannels: plan.channels ?? undefined,
            sampleRate: settings.sampleRate ?? undefined,
            forceTranscode: transform && !lossless,
          }
        : { discard: true },
      trim: start !== undefined || end !== undefined ? { start, end } : undefined,
      tags: settings.metadata === 'all' ? undefined : {},
      showWarnings: false,
    };
    try {
      const conversion = await Conversion.init(options);
      const needed = conversion.discardedTracks.filter(
        (discarded) =>
          discarded.reason !== 'discarded_by_user' &&
          discarded.reason !== 'max_track_count_reached' &&
          discarded.reason !== 'max_track_count_of_type_reached',
      );
      if (
        !conversion.isValid ||
        needed.some((d) => (d.track.isVideoTrack() ? keepsVideo : keepsAudio))
      ) {
        throw new NeedsFfmpeg(needed.map((d) => d.reason).join(', ') || 'Not convertible natively');
      }
      conversion.onProgress = (progress) => onProgress(Math.min(0.99, progress));
      await conversion.execute();
      if (!target.buffer) throw new Error('The converter produced no output');
      return new Uint8Array(target.buffer);
    } finally {
      input.dispose();
    }
  };

  // Hardware encoders overshoot: aim low, measure, and re-encode once if still over.
  const aim = plan.video !== null && sized ? Math.round(plan.video * 0.94) : plan.video;
  let bytes = await run(keepsVideo ? aim : null);
  if (sized && bytes.length > settings.targetBytes! && plan.video && keepsVideo) {
    const corrected = Math.round(aim! * (settings.targetBytes! / bytes.length) * 0.95);
    bytes = await run(corrected);
  }
  if (sized && bytes.length > settings.targetBytes!)
    notes.push("Couldn't get under the target size");
  onProgress(1);
  return { bytes, notes };
}
