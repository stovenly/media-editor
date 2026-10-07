// Reads container, duration and tracks with Mediabunny, and grabs a thumbnail. Runs in a worker.
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';

export type AvProbe = {
  native: boolean;
  container: string;
  duration: number; // seconds
  video?: {
    codec: string | null;
    width: number;
    height: number;
    fps: number | null;
    bitrate: number | null; // bits per second
    decodable: boolean;
    alpha: boolean;
  };
  audio?: {
    codec: string | null;
    sampleRate: number;
    channels: number;
    bitrate: number | null;
    decodable: boolean;
  };
  tags: { location: boolean; title: string | null; hasCover: boolean };
};

export async function probeAv(
  file: File,
  thumbSize: number,
): Promise<{ probe: AvProbe; thumbnail?: Blob } | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    if (!(await input.canRead())) return null;
    const format = await input.getFormat();
    const duration = await input.computeDuration();
    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTrack = await input.getPrimaryAudioTrack();
    const probe: AvProbe = {
      native: true,
      container: format.name,
      duration,
      tags: { location: false, title: null, hasCover: false },
    };
    if (videoTrack) {
      const stats = await videoTrack.computePacketStats(120).catch(() => null);
      probe.video = {
        codec: await videoTrack.getCodec(),
        width: await videoTrack.getDisplayWidth(),
        height: await videoTrack.getDisplayHeight(),
        fps: stats?.averagePacketRate ? Math.round(stats.averagePacketRate * 100) / 100 : null,
        bitrate: stats?.averageBitrate ?? null,
        decodable: await videoTrack.canDecode().catch(() => false),
        alpha: await videoTrack.canBeTransparent().catch(() => false),
      };
    }
    if (audioTrack) {
      probe.audio = {
        codec: await audioTrack.getCodec(),
        sampleRate: await audioTrack.getSampleRate(),
        channels: await audioTrack.getNumberOfChannels(),
        bitrate: await audioTrack.getAverageBitrate().catch(() => null),
        decodable: await audioTrack.canDecode().catch(() => false),
      };
    }
    try {
      const tags = await input.getMetadataTags();
      probe.tags.title = tags.title ?? null;
      probe.tags.hasCover = Boolean(tags.images?.length);
      const raw = JSON.stringify(tags.raw ?? {}, (_, value: unknown) =>
        value instanceof Uint8Array ? undefined : value,
      );
      probe.tags.location = /©xyz|location|ISO6709|GPS/i.test(raw);
    } catch {
      // Tags are optional.
    }
    let thumbnail: Blob | undefined;
    if (videoTrack && probe.video?.decodable) {
      try {
        const sink = new CanvasSink(videoTrack, {
          width: thumbSize,
          height: thumbSize,
          fit: 'contain',
          poolSize: 1,
          alpha: probe.video.alpha,
        });
        const frame = await sink.getCanvas(Math.min(duration * 0.1, 3));
        const canvas = frame?.canvas;
        if (canvas && 'convertToBlob' in canvas)
          thumbnail = await canvas.convertToBlob({ type: 'image/png' });
      } catch {
        // No thumbnail.
      }
    }
    return { probe, thumbnail };
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}
