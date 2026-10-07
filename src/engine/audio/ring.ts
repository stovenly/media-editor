// A single-producer, single-consumer ring of interleaved Float32 frames in a SharedArrayBuffer.
// Header (Int32): [0] frames written, [1] frames read, [2] state. ring-processor.js reads the same layout.
export const HEADER_BYTES = 16;
export const WRITTEN = 0;
export const READ = 1;
export const STATE = 2;
export const STATE_PLAYING = 1;
export const STATE_ENDED = 2;

export type Ring = { sab: SharedArrayBuffer; capacity: number; channels: number };

export function createRing(sampleRate: number, channels: number, seconds = 1): Ring {
  const capacity = Math.round(sampleRate * seconds);
  const sab = new SharedArrayBuffer(HEADER_BYTES + capacity * channels * 4);
  return { sab, capacity, channels };
}

export class RingWriter {
  private header: Int32Array;
  private data: Float32Array;

  constructor(private readonly ring: Ring) {
    this.header = new Int32Array(ring.sab, 0, 4);
    this.data = new Float32Array(ring.sab, HEADER_BYTES);
  }

  get free(): number {
    return (
      this.ring.capacity - (Atomics.load(this.header, WRITTEN) - Atomics.load(this.header, READ))
    );
  }

  // Waits (up to `ms`) for the reader to make room; returns false if it didn't.
  waitForSpace(frames: number, ms: number): boolean {
    const deadline = performance.now() + ms;
    while (this.free < frames) {
      const read = Atomics.load(this.header, READ);
      const left = deadline - performance.now();
      if (left <= 0) return false;
      Atomics.wait(this.header, READ, read, Math.min(left, 20));
    }
    return true;
  }

  write(block: Float32Array[], start = 0, count = (block[0]?.length ?? 0) - start): void {
    const { capacity, channels } = this.ring;
    let written = Atomics.load(this.header, WRITTEN);
    for (let i = 0; i < count; i++) {
      const at = (written % capacity) * channels;
      for (let c = 0; c < channels; c++)
        this.data[at + c] = block[Math.min(c, block.length - 1)]![start + i]!;
      written += 1;
    }
    Atomics.store(this.header, WRITTEN, written);
  }

  setState(state: number): void {
    Atomics.store(this.header, STATE, state);
  }
}

export function framesRead(ring: Ring): number {
  return Atomics.load(new Int32Array(ring.sab, 0, 4), READ);
}

export function ringState(ring: Ring): number {
  return Atomics.load(new Int32Array(ring.sab, 0, 4), STATE);
}

export function bufferedFrames(ring: Ring): number {
  const header = new Int32Array(ring.sab, 0, 4);
  return Atomics.load(header, WRITTEN) - Atomics.load(header, READ);
}
