// One audio editing session: open files, waveform peaks, real-time playback into a ring, and export.
import * as Comlink from 'comlink';
import {
  exportProject,
  type AudioExportResult,
  type AudioExportSettings,
} from '../engine/audio/export';
import { BLOCK_FRAMES, renderMix } from '../engine/audio/render';
import { RingWriter, STATE_ENDED, STATE_PLAYING, type Ring } from '../engine/audio/ring';
import { computePeaks, openAsset, type AssetHandle } from '../engine/audio/source';
import { messageOf } from '../engine/errors';
import { projectDuration, type AudioAssetInfo, type AudioProject } from '../project/audio';
import { attachProgress, reportProgress } from './progress';

const assets = new Map<string, AssetHandle>();
let playback = 0;

const api = {
  attach: attachProgress,

  async open(files: { id: string; file: File }[]): Promise<AudioAssetInfo[]> {
    try {
      return await Promise.all(
        files.map(async ({ id, file }) => {
          const asset = assets.get(id) ?? (await openAsset(file));
          assets.set(id, asset);
          return {
            id,
            name: file.name,
            duration: asset.duration,
            sampleRate: asset.sampleRate,
            channels: asset.channels,
          };
        }),
      );
    } catch (error) {
      throw new Error(messageOf(error), { cause: error });
    }
  },

  async peaks(id: string, perSecond: number): Promise<Float32Array> {
    const asset = assets.get(id);
    if (!asset) throw new Error('Unknown file');
    const peaks = await computePeaks(asset, perSecond, () => {});
    return Comlink.transfer(peaks, [peaks.buffer]);
  },

  // Renders ahead of the audio thread from `from` until stopped, the timeline ends, or `play` is called again.
  async play(project: AudioProject, from: number, ring: Ring, until?: number): Promise<void> {
    const session = ++playback;
    const writer = new RingWriter(ring);
    writer.setState(STATE_PLAYING);
    const to = until ?? projectDuration(project);
    try {
      for await (const block of renderMix(project, assets, { from, to, gain: 1 })) {
        const frames = block[0]?.length ?? 0;
        let offset = 0;
        while (offset < frames) {
          if (session !== playback) return;
          const chunk = Math.min(frames - offset, BLOCK_FRAMES);
          if (!writer.waitForSpace(chunk, 100)) continue;
          writer.write(block, offset, chunk);
          offset += chunk;
        }
        if (session !== playback) return;
      }
      writer.setState(STATE_ENDED);
    } catch (error) {
      writer.setState(STATE_ENDED);
      throw new Error(messageOf(error), { cause: error });
    }
  },

  stop(): void {
    playback += 1;
  },

  async export(
    jobId: string,
    project: AudioProject,
    settings: AudioExportSettings,
  ): Promise<AudioExportResult> {
    try {
      const result = await exportProject(project, assets, settings, (f) =>
        reportProgress(jobId, f),
      );
      return Comlink.transfer(result, [result.bytes.buffer as ArrayBuffer]);
    } catch (error) {
      throw new Error(messageOf(error), { cause: error });
    }
  },
};

export type AudioApi = typeof api;

Comlink.expose(api);
