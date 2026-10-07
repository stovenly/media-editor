// Exports a cut-only edit by copying encoded packets: no re-encoding, so cuts land on key frames.
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  type EncodedPacket,
} from 'mediabunny';

export type CopyResult = { bytes: Uint8Array; container: 'mp4' | 'webm'; notes: string[] };

type Range = { in: number; out: number };

export async function copyCuts(
  file: File,
  ranges: readonly Range[],
  preferred: 'mp4' | 'webm',
  onProgress: (fraction: number) => void,
): Promise<CopyResult> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('This video has no picture to copy');
    const audio = await input.getPrimaryAudioTrack();
    const videoCodec = await video.getCodec();
    const audioCodec = audio ? await audio.getCodec() : null;
    if (!videoCodec) throw new Error("This video's format can't be copied");

    const formats = {
      mp4: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      webm: new WebMOutputFormat(),
    };
    const fits = (c: 'mp4' | 'webm') =>
      formats[c].getSupportedVideoCodecs().includes(videoCodec) &&
      (!audioCodec || formats[c].getSupportedAudioCodecs().includes(audioCodec));
    const container = fits(preferred)
      ? preferred
      : fits(preferred === 'mp4' ? 'webm' : 'mp4')
        ? preferred === 'mp4'
          ? 'webm'
          : 'mp4'
        : null;
    if (!container) throw new Error("This video's codecs can't be copied into MP4 or WebM");

    const target = new BufferTarget();
    const output = new Output({ format: formats[container], target });
    const videoOut = new EncodedVideoPacketSource(videoCodec);
    output.addVideoTrack(videoOut, { rotation: await video.getRotation() });
    const audioOut = audioCodec ? new EncodedAudioPacketSource(audioCodec) : null;
    if (audioOut) output.addAudioTrack(audioOut);
    await output.start();

    const videoSink = new EncodedPacketSink(video);
    const audioSink = audio ? new EncodedPacketSink(audio) : null;
    const videoConfig = (await video.getDecoderConfig()) ?? undefined;
    const audioConfig = audio ? ((await audio.getDecoderConfig()) ?? undefined) : undefined;
    let firstVideo = true;
    let firstAudio = true;
    let cursor = 0;
    let requested = 0;
    let copied = 0;
    const total = ranges.reduce((sum, r) => sum + (r.out - r.in), 0);

    for (const range of ranges) {
      requested += range.out - range.in;
      const start =
        (await videoSink.getKeyPacket(range.in)) ?? (await videoSink.getFirstKeyPacket());
      if (!start) continue;
      const atOut = await videoSink.getKeyPacket(range.out);
      const end =
        atOut && atOut.timestamp >= range.out - 1e-6 && atOut.timestamp > start.timestamp
          ? atOut
          : atOut
            ? await videoSink.getNextKeyPacket(atOut)
            : null;
      const from = start.timestamp;
      const to = end ? end.timestamp : await video.computeDuration();
      const shift = cursor - from;

      for await (const packet of videoSink.packets(start, end ?? undefined)) {
        await videoOut.add(
          retime(packet, shift),
          firstVideo ? { decoderConfig: videoConfig } : undefined,
        );
        firstVideo = false;
        onProgress(Math.min(0.99, (copied + packet.timestamp - from) / Math.max(total, 0.001)));
      }
      if (audioSink && audioOut) {
        let packet = await audioSink.getPacket(from);
        if (packet && packet.timestamp < from - 1e-6)
          packet = await audioSink.getNextPacket(packet);
        while (packet && packet.timestamp < to - 1e-6) {
          await audioOut.add(
            retime(packet, shift),
            firstAudio ? { decoderConfig: audioConfig } : undefined,
          );
          firstAudio = false;
          packet = await audioSink.getNextPacket(packet);
        }
      }
      cursor += to - from;
      copied += to - from;
    }
    await output.finalize();
    if (!target.buffer) throw new Error('The export produced no output');
    onProgress(1);
    const notes = ['Copied without re-encoding, so there is no quality loss'];
    if (Math.abs(cursor - requested) > 0.05)
      notes.push(
        `Cuts moved to the nearest key frames: ${cursor.toFixed(2)} s instead of ${requested.toFixed(2)} s`,
      );
    if (container !== preferred)
      notes.push(`Saved as ${container.toUpperCase()}, which can hold this video's format`);
    return { bytes: new Uint8Array(target.buffer), container, notes };
  } finally {
    input.dispose();
  }
}

function retime(packet: EncodedPacket, shift: number): EncodedPacket {
  return packet.clone({ timestamp: Math.max(0, packet.timestamp + shift) });
}
