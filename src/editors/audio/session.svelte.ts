// Main-thread side of the audio editor: the worker, waveform peaks, and playback through an AudioWorklet.
import * as Comlink from 'comlink';
import { hub } from '../../engine';
import type { AudioExportResult, AudioExportSettings } from '../../engine/audio/export';
import {
  bufferedFrames,
  createRing,
  framesRead,
  ringState,
  STATE_ENDED,
  type Ring,
} from '../../engine/audio/ring';
import processorUrl from '../../engine/audio/ring-processor.js?url';
import type { AudioAssetInfo, AudioProject } from '../../project/audio';
import type { AudioApi } from '../../workers/audio.worker';

export const PEAKS_PER_SECOND = 200;

let exportCounter = 0;
const VOLUME_KEY = 'playback-volume';

function storedVolume(): number {
  const saved = Number(localStorage.getItem(VOLUME_KEY));
  return Number.isFinite(saved) && localStorage.getItem(VOLUME_KEY) !== null ? saved : 0.8;
}

export class AudioSession {
  assets = $state.raw<AudioAssetInfo[]>([]);
  peaks = $state.raw<ReadonlyMap<string, Float32Array>>(new Map());
  playing = $state(false);
  position = $state(0); // seconds on the timeline
  error = $state<string | null>(null);
  volume = $state(storedVolume()); // 0..1, playback only
  muted = $state(false);

  private worker: Worker;
  private api: Comlink.Remote<AudioApi>;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private output: GainNode | null = null;
  private ring: Ring | null = null;
  private startedAt = 0;
  private speed = 1;
  private rate = 48000;
  private frame = 0;

  constructor() {
    this.worker = new Worker(new URL('../../workers/audio.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.api = Comlink.wrap<AudioApi>(this.worker);
    const channel = new MessageChannel();
    hub.listen(channel.port1);
    void this.api.attach(Comlink.transfer(channel.port2, [channel.port2]));
  }

  async open(files: { id: string; file: File }[], withPeaks = true): Promise<AudioAssetInfo[]> {
    const opened = await this.api.open(files);
    const known = new Set(this.assets.map((a) => a.id));
    this.assets = [...this.assets, ...opened.filter((a) => !known.has(a.id))];
    for (const asset of withPeaks ? opened : []) {
      if (this.peaks.has(asset.id)) continue;
      void this.api.peaks(asset.id, PEAKS_PER_SECOND).then((peaks) => {
        this.peaks = new Map(this.peaks).set(asset.id, peaks);
      });
    }
    return opened;
  }

  async play(project: AudioProject, from: number, until?: number): Promise<Ring> {
    this.stop();
    const rate = project.sampleRate;
    if (!this.context || this.context.sampleRate !== rate) {
      await this.context?.close();
      this.output = null;
      this.context = new AudioContext({ sampleRate: rate, latencyHint: 'playback' });
      await this.context.audioWorklet.addModule(processorUrl);
    }
    await this.context.resume();
    this.ring = createRing(rate, 2, 1);
    this.node = new AudioWorkletNode(this.context, 'ring-player', {
      outputChannelCount: [2],
      processorOptions: {
        sab: this.ring.sab,
        capacity: this.ring.capacity,
        channels: this.ring.channels,
      },
    });
    this.output ??= this.context.createGain();
    this.output.connect(this.context.destination);
    this.applyVolume();
    this.node.connect(this.output);
    this.startedAt = from;
    this.speed = project.speed;
    this.rate = rate;
    this.position = from;
    this.playing = true;
    this.api.play(project, from, this.ring, until).catch((error: unknown) => {
      this.error = error instanceof Error ? error.message : String(error);
    });
    this.tick();
    return this.ring;
  }

  setVolume(volume: number, muted = false): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.muted = muted;
    localStorage.setItem(VOLUME_KEY, String(this.volume));
    this.applyVolume();
  }

  // Squared, so the slider feels even to the ear.
  private applyVolume(): void {
    if (!this.output || !this.context) return;
    const level = this.muted ? 0 : this.volume ** 2;
    this.output.gain.setTargetAtTime(level, this.context.currentTime, 0.015);
  }

  stop(): void {
    if (!this.playing && !this.node) return;
    void this.api.stop();
    this.node?.disconnect();
    this.node = null;
    this.playing = false;
    cancelAnimationFrame(this.frame);
  }

  seek(time: number): void {
    this.position = Math.max(0, time);
  }

  private tick = (): void => {
    const ring = this.ring;
    if (!ring || !this.playing) return;
    const played = framesRead(ring) / this.rate;
    this.position = this.startedAt + played * this.speed;
    if (ringState(ring) === STATE_ENDED && bufferedFrames(ring) === 0) {
      this.stop();
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  async export(
    project: AudioProject,
    settings: AudioExportSettings,
    onJob: (jobId: string) => void,
  ): Promise<AudioExportResult> {
    const jobId = `audio-export-${++exportCounter}`;
    onJob(jobId);
    try {
      return await this.api.export(jobId, project, settings);
    } finally {
      hub.forget(jobId);
    }
  }

  close(): void {
    this.stop();
    void this.context?.close();
    this.worker.terminate();
  }
}
