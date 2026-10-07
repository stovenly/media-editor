// Block DSP on planar Float32 audio: one Float32Array per channel, samples in -1..1.
export type Planar = Float32Array[];

export function silence(channels: number, frames: number): Planar {
  return Array.from({ length: channels }, () => new Float32Array(frames));
}

export function framesOf(block: Planar): number {
  return block[0]?.length ?? 0;
}

// Maps any channel count onto 1 or 2: stereo sources are averaged for mono, mono is duplicated for stereo.
export function remapChannels(block: Planar, channels: number): Planar {
  if (block.length === channels) return block;
  const frames = framesOf(block);
  if (channels === 1) {
    const out = new Float32Array(frames);
    for (const plane of block) for (let i = 0; i < frames; i++) out[i]! += plane[i]! / block.length;
    return [out];
  }
  if (block.length === 1) return [block[0]!, block[0]!.slice()];
  return [block[0]!, block[1]!];
}

export type ChannelOp = 'none' | 'mono' | 'swap' | 'left' | 'right';

export function applyChannelOp(block: Planar, op: ChannelOp): Planar {
  if (op === 'none' || block.length < 2) return block;
  const [left, right] = block as [Float32Array, Float32Array];
  if (op === 'swap') return [right, left];
  if (op === 'left') return [left, left.slice()];
  if (op === 'right') return [right.slice(), right];
  const mono = new Float32Array(left.length);
  for (let i = 0; i < mono.length; i++) mono[i] = (left[i]! + right[i]!) / 2;
  return [mono, mono.slice()];
}

// Equal-power fade: 0..1 progress to a gain, so crossfading clips keep roughly constant loudness.
export function fadeCurve(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return Math.sin((p * Math.PI) / 2);
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export function gainToDb(gain: number): number {
  return 20 * Math.log10(Math.max(gain, 1e-9));
}

// Streaming resampler with 4-point cubic interpolation. Keeps three frames of history between blocks.
export class Resampler {
  private position = 0; // fractional read position into `history ++ input`, in input frames
  private history: Planar;
  private readonly step: number;

  constructor(
    inRate: number,
    outRate: number,
    private readonly channels: number,
  ) {
    this.step = inRate / outRate;
    this.history = silence(channels, 3);
    this.position = 1;
  }

  get passthrough(): boolean {
    return this.step === 1;
  }

  process(input: Planar): Planar {
    if (this.passthrough) return input;
    const inFrames = framesOf(input);
    const joined = this.history.map((past, c) => {
      const all = new Float32Array(past.length + inFrames);
      all.set(past);
      all.set(input[c] ?? new Float32Array(inFrames), past.length);
      return all;
    });
    const available = framesOf(joined);
    const outFrames = Math.max(0, Math.floor((available - 2 - this.position) / this.step));
    const out = silence(this.channels, outFrames);
    let pos = this.position;
    for (let i = 0; i < outFrames; i++) {
      const base = Math.floor(pos);
      const t = pos - base;
      for (let c = 0; c < this.channels; c++) {
        const s = joined[c]!;
        const y0 = s[base - 1] ?? s[base]!;
        const y1 = s[base]!;
        const y2 = s[base + 1]!;
        const y3 = s[base + 2] ?? y2;
        const a = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
        const b = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
        const cc = -0.5 * y0 + 0.5 * y2;
        out[c]![i] = ((a * t + b) * t + cc) * t + y1;
      }
      pos += this.step;
    }
    const keepFrom = Math.max(0, Math.floor(pos) - 1);
    this.history = joined.map((s) => s.slice(keepFrom));
    this.position = pos - keepFrom;
    return out;
  }
}

// ITU-R BS.1770 / EBU R128 integrated loudness. Feed blocks at one sample rate; read `integrated` at the end.
export class LoudnessMeter {
  private filters: { a: Biquad; b: Biquad }[];
  private blockSize: number;
  private hop: number;
  private squares: Float64Array[] = [];
  private filled = 0;
  private sinceHop = 0;
  private powers: number[] = [];
  peak = 0;

  constructor(
    private readonly sampleRate: number,
    private readonly channels: number,
  ) {
    this.filters = Array.from({ length: channels }, () => kWeighting(sampleRate));
    this.blockSize = Math.round(sampleRate * 0.4);
    this.hop = Math.round(sampleRate * 0.1);
    this.squares = Array.from({ length: channels }, () => new Float64Array(this.blockSize));
  }

  add(block: Planar): void {
    const frames = framesOf(block);
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < this.channels; c++) {
        const x = block[c]![i]!;
        const abs = Math.abs(x);
        if (abs > this.peak) this.peak = abs;
        const { a, b } = this.filters[c]!;
        const y = b.run(a.run(x));
        this.squares[c]![this.filled % this.blockSize] = y * y;
      }
      this.filled += 1;
      this.sinceHop += 1;
      if (this.filled >= this.blockSize && this.sinceHop >= this.hop) {
        this.sinceHop = 0;
        let power = 0;
        for (let c = 0; c < this.channels; c++) {
          let sum = 0;
          for (const s of this.squares[c]!) sum += s;
          power += sum / this.blockSize;
        }
        this.powers.push(power);
      }
    }
  }

  // LUFS, or -Infinity for silence.
  get integrated(): number {
    const loud = (p: number) => -0.691 + 10 * Math.log10(p);
    const absolute = this.powers.filter((p) => p > 0 && loud(p) > -70);
    if (absolute.length === 0) return -Infinity;
    const mean = absolute.reduce((s, p) => s + p, 0) / absolute.length;
    const relative = loud(mean) - 10;
    const gated = absolute.filter((p) => loud(p) > relative);
    return loud(gated.reduce((s, p) => s + p, 0) / gated.length);
  }
}

class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(
    private b0: number,
    private b1: number,
    private b2: number,
    private a1: number,
    private a2: number,
  ) {}
  run(x: number): number {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

// The two K-weighting stages from BS.1770, re-derived for any sample rate.
function kWeighting(rate: number): { a: Biquad; b: Biquad } {
  let f0 = 1681.974450955533;
  const g = 3.999843853973347;
  let q = 0.7071752369554196;
  let k = Math.tan((Math.PI * f0) / rate);
  const vh = 10 ** (g / 20);
  const vb = vh ** 0.4996667741545416;
  let a0 = 1 + k / q + k * k;
  const shelf = new Biquad(
    (vh + (vb * k) / q + k * k) / a0,
    (2 * (k * k - vh)) / a0,
    (vh - (vb * k) / q + k * k) / a0,
    (2 * (k * k - 1)) / a0,
    (1 - k / q + k * k) / a0,
  );
  f0 = 38.13547087602444;
  q = 0.5003270373238773;
  k = Math.tan((Math.PI * f0) / rate);
  a0 = 1 + k / q + k * k;
  const highpass = new Biquad(1, -2, 1, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0);
  return { a: shelf, b: highpass };
}

// WSOLA time-stretch: changes duration by 1/speed while keeping pitch. Streaming, mono-linked across channels.
export class TimeStretch {
  private input: Planar;
  private output: Planar;
  private readonly frame: number;
  private readonly overlap: number;
  private readonly search: number;
  private readPos = 0;
  private outPos = 0;
  private window: Float32Array;

  constructor(
    sampleRate: number,
    private readonly channels: number,
    private readonly speed: number,
  ) {
    this.frame = Math.round(sampleRate * 0.04);
    this.overlap = Math.round(this.frame / 2);
    this.search = Math.round(sampleRate * 0.012);
    this.input = silence(channels, 0);
    this.output = silence(channels, 0);
    this.window = new Float32Array(this.overlap);
    for (let i = 0; i < this.overlap; i++) this.window[i] = fadeCurve(i / this.overlap) ** 2;
  }

  get passthrough(): boolean {
    return this.speed === 1;
  }

  process(block: Planar, final = false): Planar {
    if (this.passthrough) return block;
    this.input = this.input.map((buf, c) =>
      concat(buf, block[c] ?? new Float32Array(framesOf(block))),
    );
    const hopOut = this.frame - this.overlap;
    const hopIn = hopOut * this.speed;
    const produced: Planar = silence(this.channels, 0);
    const pieces: Planar[] = [];
    while (this.readPos + this.frame + this.search * 2 < framesOf(this.input)) {
      const nominal = Math.round(this.readPos);
      const offset = this.outPos === 0 ? 0 : this.bestOffset(nominal);
      const start = Math.max(0, nominal + offset);
      const piece = this.input.map((buf) => buf.slice(start, start + this.frame));
      if (this.outPos === 0) {
        pieces.push(piece.map((p) => p.slice(0, hopOut)));
        this.output = piece.map((p) => p.slice(hopOut));
      } else {
        const mixed = piece.map((p, c) => {
          const tail = this.output[c]!;
          const out = new Float32Array(hopOut);
          for (let i = 0; i < hopOut; i++) {
            if (i < this.overlap) {
              const w = this.window[i]!;
              out[i] = (tail[i] ?? 0) * (1 - w) + p[i]! * w;
            } else out[i] = p[i]!;
          }
          return out;
        });
        pieces.push(mixed);
        this.output = piece.map((p) => p.slice(hopOut));
      }
      this.outPos += hopOut;
      this.readPos += hopIn;
    }
    const drop = Math.max(0, Math.floor(this.readPos) - this.search * 2);
    if (drop > 0) {
      this.input = this.input.map((buf) => buf.slice(drop));
      this.readPos -= drop;
    }
    let result = pieces.reduce(
      (acc, piece) => acc.map((buf, c) => concat(buf, piece[c]!)),
      produced,
    );
    if (final) result = result.map((buf, c) => concat(buf, this.output[c]!.slice(0, this.overlap)));
    return result;
  }

  // Finds the shift around `nominal` whose start best continues the previous frame's tail.
  private bestOffset(nominal: number): number {
    const reference = this.output[0]!;
    const source = this.input[0]!;
    let best = 0;
    let bestScore = -Infinity;
    for (let offset = -this.search; offset <= this.search; offset += 2) {
      const start = nominal + offset;
      if (start < 0) continue;
      let score = 0;
      for (let i = 0; i < this.overlap; i += 4)
        score += (reference[i] ?? 0) * (source[start + i] ?? 0);
      if (score > bestScore) {
        bestScore = score;
        best = offset;
      }
    }
    return best;
  }
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
