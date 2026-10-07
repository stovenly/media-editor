// Streams decoded audio from one file, converted to the project's rate and channel count. Runs in a worker.
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input, type InputAudioTrack } from 'mediabunny';
import { framesOf, remapChannels, Resampler, silence, type Planar } from './dsp';

export type AssetHandle = {
  input: Input;
  track: InputAudioTrack;
  sampleRate: number;
  channels: number;
  duration: number;
};

export async function openAsset(file: File): Promise<AssetHandle> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error(`${file.name} has no audio`);
  if (!(await track.canDecode())) throw new Error(`${file.name} can't be decoded here`);
  return {
    input,
    track,
    sampleRate: await track.getSampleRate(),
    channels: await track.getNumberOfChannels(),
    duration: await track.computeDuration(),
  };
}

export class SourceReader {
  private iterator: AsyncGenerator<import('mediabunny').AudioSample, void, unknown>;
  private buffer: Planar;
  private resampler: Resampler;
  private done = false;
  private skip: number; // seconds of decoded audio still to drop before `from`

  constructor(
    private readonly asset: AssetHandle,
    from: number,
    private readonly rate: number,
    private readonly channels: number,
  ) {
    this.iterator = new AudioSampleSink(asset.track).samples(Math.max(0, from));
    this.buffer = silence(channels, 0);
    this.resampler = new Resampler(asset.sampleRate, rate, channels);
    this.skip = from;
  }

  // Exactly `frames` frames at the project rate; silence past the end of the source.
  async read(frames: number): Promise<Planar> {
    while (framesOf(this.buffer) < frames && !this.done) {
      const next = await this.iterator.next();
      if (next.done) {
        this.done = true;
        break;
      }
      const sample = next.value;
      let planes = toPlanar(sample);
      const timestamp = sample.timestamp;
      sample.close();
      if (this.skip > timestamp) {
        const drop = Math.min(
          framesOf(planes),
          Math.round((this.skip - timestamp) * this.asset.sampleRate),
        );
        planes = planes.map((p) => p.subarray(drop));
      }
      this.skip = 0;
      const block = this.resampler.process(remapChannels(planes, this.channels));
      this.buffer = this.buffer.map((b, c) => join(b, block[c]!));
    }
    const out = silence(this.channels, frames);
    const take = Math.min(frames, framesOf(this.buffer));
    for (let c = 0; c < this.channels; c++) out[c]!.set(this.buffer[c]!.subarray(0, take));
    this.buffer = this.buffer.map((b) => b.subarray(take));
    return out;
  }

  close(): void {
    void this.iterator.return(undefined);
  }
}

function toPlanar(sample: import('mediabunny').AudioSample): Planar {
  const planes: Planar = [];
  for (let c = 0; c < sample.numberOfChannels; c++) {
    const plane = new Float32Array(sample.numberOfFrames);
    sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
    planes.push(plane);
  }
  return planes;
}

function join(a: Float32Array, b: Float32Array): Float32Array {
  if (a.length === 0) return b;
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

// Min/max pairs per bucket of `1 / perSecond` seconds, over all channels.
export async function computePeaks(
  asset: AssetHandle,
  perSecond: number,
  onProgress: (fraction: number) => void,
): Promise<Float32Array> {
  const buckets = Math.max(1, Math.ceil(asset.duration * perSecond));
  const peaks = new Float32Array(buckets * 2);
  const bucketFrames = asset.sampleRate / perSecond;
  for await (const sample of new AudioSampleSink(asset.track).samples()) {
    const planes = toPlanar(sample);
    const first = Math.round(sample.timestamp * asset.sampleRate);
    for (let i = 0; i < sample.numberOfFrames; i++) {
      const bucket = Math.min(buckets - 1, Math.floor((first + i) / bucketFrames));
      for (const plane of planes) {
        const v = plane[i]!;
        if (v < peaks[bucket * 2]!) peaks[bucket * 2] = v;
        if (v > peaks[bucket * 2 + 1]!) peaks[bucket * 2 + 1] = v;
      }
    }
    onProgress(Math.min(1, sample.timestamp / Math.max(asset.duration, 0.001)));
    sample.close();
  }
  return peaks;
}
