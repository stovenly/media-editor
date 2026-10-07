// Main-thread side of the video editor: the compositor worker owns the preview canvas, the audio session the sound.
import * as Comlink from 'comlink';
import { hub } from '../../engine';
import { messageOf } from '../../engine/errors';
import type { VideoExportSettings } from '../../engine/video/export';
import type { FileItem } from '../../converter/files.svelte';
import { DEFAULT_OPTIONS } from '../../converter/options';
import { startJob } from '../../converter/run';
import {
  videoDuration,
  type AssetKind,
  type VideoAsset,
  type VideoProject,
} from '../../project/video';
import { soundOf } from '../../project/video-audio';
import type { VideoApi } from '../../workers/video.worker';
import { AudioSession } from '../audio/session.svelte';

export const PREVIEW_EDGE = 960;
const BROWSER_IMAGES = new Set(['jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg']);
let exportCounter = 0;

export class VideoSession {
  assets = $state.raw<ReadonlyMap<string, VideoAsset>>(new Map());
  preparing = $state<string | null>(null);
  error = $state<string | null>(null);
  readonly audio = new AudioSession();

  private worker: Worker;
  private api: Comlink.Remote<VideoApi>;
  private wanted: { project: VideoProject; time: number } | null = null;
  private rendering = false;

  constructor() {
    this.worker = new Worker(new URL('../../workers/video.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.api = Comlink.wrap<VideoApi>(this.worker);
    const channel = new MessageChannel();
    hub.listen(channel.port1);
    void this.api.attach(Comlink.transfer(channel.port2, [channel.port2]));
  }

  attachCanvas(canvas: HTMLCanvasElement): void {
    const offscreen = canvas.transferControlToOffscreen();
    void this.api.setCanvas(Comlink.transfer(offscreen, [offscreen]));
  }

  // Files the browser can't decode become an MP4, WAV or PNG first, so preview and export share one path.
  async add(item: FileItem): Promise<VideoAsset> {
    const known = this.assets.get(item.id);
    if (known) return known;
    const inspection = item.inspection!;
    const sniffed = inspection.sniffed.kind;
    const kind: AssetKind =
      sniffed === 'image'
        ? 'image'
        : sniffed === 'video' && (inspection.av?.video || !inspection.av)
          ? 'video'
          : 'audio';
    this.preparing = `Preparing ${item.file.name}…`;
    try {
      const file = await this.decodableFile(item, kind);
      const [asset] = await this.api.open([{ id: item.id, file, kind, name: item.file.name }]);
      if (asset!.hasAudio) await this.audio.open([{ id: item.id, file }], false);
      this.assets = new Map(this.assets).set(asset!.id, asset!);
      return asset!;
    } catch (error) {
      this.error = messageOf(error);
      throw error;
    } finally {
      this.preparing = null;
    }
  }

  private async decodableFile(item: FileItem, kind: AssetKind): Promise<File> {
    const av = item.inspection?.av;
    const fine =
      kind === 'image'
        ? BROWSER_IMAGES.has(item.inspection?.sniffed.format ?? '')
        : Boolean(
            av?.native &&
            (kind === 'audio' ? av.audio?.decodable : av.video?.decodable) &&
            (!av.audio || av.audio.decodable),
          );
    if (fine) return item.file;
    const targetId = kind === 'image' ? 'png' : kind === 'audio' ? 'wav' : 'mp4';
    const job = startJob({
      file: item.file,
      inspection: item.inspection!,
      targetId,
      options: { ...DEFAULT_OPTIONS, quality: 95, metadata: 'none' },
      threads: 1,
      onTask: () => {},
    });
    const output = await job.result;
    return new File([output.blob], output.name, { type: output.blob.type });
  }

  render(project: VideoProject, time: number): void {
    this.wanted = { project, time };
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.rendering) return;
    this.rendering = true;
    try {
      while (this.wanted) {
        const { project, time } = this.wanted;
        this.wanted = null;
        await this.api.render(project, time, PREVIEW_EDGE);
      }
    } catch (error) {
      this.error = messageOf(error);
    } finally {
      this.rendering = false;
    }
  }

  // Resolves once sound is playing; frames follow the audio clock until `stop`.
  async play(project: VideoProject, from: number): Promise<void> {
    const duration = videoDuration(project);
    const sound = soundOf(project, this.assets);
    const ring = await this.audio.play(sound, from, duration);
    this.api.play(project, from, ring, sound.sampleRate, PREVIEW_EDGE).catch((error: unknown) => {
      this.error = messageOf(error);
    });
  }

  stop(): void {
    this.audio.stop();
    void this.api.stop();
  }

  async export(
    project: VideoProject,
    settings: VideoExportSettings,
    onJob: (jobId: string) => void,
  ) {
    const jobId = `video-export-${++exportCounter}`;
    onJob(jobId);
    try {
      return await this.api.export(jobId, project, settings);
    } finally {
      hub.forget(jobId);
    }
  }

  close(): void {
    this.stop();
    this.audio.close();
    this.worker.terminate();
  }
}
