// AudioWorklet side of the playback ring in ring.ts: header [written, read, state], then interleaved frames.
const HEADER_BYTES = 16;

class RingPlayer extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { sab, capacity, channels } = options.processorOptions;
    this.header = new Int32Array(sab, 0, 4);
    this.data = new Float32Array(sab, HEADER_BYTES);
    this.capacity = capacity;
    this.channels = channels;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const frames = output[0].length;
    const written = Atomics.load(this.header, 0);
    let read = Atomics.load(this.header, 1);
    const available = Math.min(frames, written - read);
    for (let i = 0; i < available; i++) {
      const at = (read % this.capacity) * this.channels;
      for (let c = 0; c < output.length; c++)
        output[c][i] = this.data[at + Math.min(c, this.channels - 1)];
      read += 1;
    }
    for (let c = 0; c < output.length; c++) output[c].fill(0, available);
    Atomics.store(this.header, 1, read);
    Atomics.notify(this.header, 1);
    return true;
  }
}

registerProcessor('ring-player', RingPlayer);
