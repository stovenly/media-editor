// Frame access for the compositor: sequential reads stay on one decoder, jumps re-seek. Runs in a worker.
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink, type VideoSample } from 'mediabunny';

export type Drawable = {
  image: CanvasImageSource;
  width: number;
  height: number;
  rotation: number;
};

const SEEK_WINDOW = 1.5; // seconds ahead that are reached by decoding forward instead of seeking

export class VideoFrames {
  private iterator: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private current: VideoSample | null = null;
  private lookahead: VideoSample | null = null;
  private frame: VideoFrame | null = null;

  private constructor(
    private readonly input: Input,
    private readonly sink: VideoSampleSink,
  ) {}

  static async open(file: File): Promise<VideoFrames | null> {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) {
      input.dispose();
      return null;
    }
    return new VideoFrames(input, new VideoSampleSink(track));
  }

  async at(time: number): Promise<Drawable | null> {
    const t = Math.max(0, time);
    const current = this.current;
    const reusable =
      current && t >= current.timestamp && t < current.timestamp + SEEK_WINDOW && this.iterator;
    if (!reusable) await this.seek(t);
    while (this.current) {
      if (!this.lookahead) {
        const next = await this.iterator!.next();
        if (next.done) break;
        this.lookahead = next.value;
      }
      if (this.lookahead.timestamp > t + 1e-4) break;
      this.replace(this.lookahead);
      this.lookahead = null;
    }
    if (!this.current) return null;
    if (!this.frame) this.frame = this.current.toVideoFrame();
    return {
      image: this.frame,
      width: this.frame.displayWidth,
      height: this.frame.displayHeight,
      rotation: this.current.rotation,
    };
  }

  private async seek(t: number): Promise<void> {
    await this.iterator?.return(undefined);
    this.lookahead?.close();
    this.lookahead = null;
    this.iterator = this.sink.samples(t);
    const first = await this.iterator.next();
    this.replace(first.done ? null : first.value);
  }

  private replace(sample: VideoSample | null): void {
    this.frame?.close();
    this.frame = null;
    this.current?.close();
    this.current = sample;
  }

  close(): void {
    void this.iterator?.return(undefined);
    this.replace(null);
    this.lookahead?.close();
    this.input.dispose();
  }
}

export async function stillImage(file: File): Promise<Drawable> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return { image: bitmap, width: bitmap.width, height: bitmap.height, rotation: 0 };
}
