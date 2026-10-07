import * as Comlink from 'comlink';
import { animateImages, convertImage } from '../engine/image/convert';
import { loadMagick, loadVips } from '../engine/image/engines';
import type { ImageResult, ImageSettings } from '../engine/image/settings';
import { messageOf } from '../engine/errors';
import { attachProgress, reportProgress } from './progress';

export type ImageJob = {
  file: File;
  format: string;
  pages: number;
  dirs: { vips: string; magick?: string };
  threads: number;
};

function enginesFor(dirs: ImageJob['dirs'], threads: number) {
  return {
    vips: () => loadVips(dirs.vips, threads),
    magick: () => {
      if (!dirs.magick) throw new Error('The extra image formats engine was not loaded');
      return loadMagick(dirs.magick);
    },
  };
}

const api = {
  attach: attachProgress,
  async animate(
    jobId: string,
    frames: { file: File; format: string }[],
    delayMs: number,
    dirs: ImageJob['dirs'],
    settings: ImageSettings,
  ): Promise<ImageResult> {
    const loaded = await Promise.all(
      frames.map(async (frame) => ({
        bytes: new Uint8Array(await frame.file.arrayBuffer()),
        format: frame.format,
      })),
    );
    const result = await animateImages(loaded, delayMs, settings, enginesFor(dirs, 1), (fraction) =>
      reportProgress(jobId, fraction),
    ).catch((error: unknown) => {
      throw new Error(messageOf(error), { cause: error });
    });
    return Comlink.transfer(result, [result.bytes.buffer as ArrayBuffer]);
  },
  async convert(jobId: string, job: ImageJob, settings: ImageSettings): Promise<ImageResult> {
    const bytes = new Uint8Array(await job.file.arrayBuffer());
    const engines = enginesFor(job.dirs, job.threads);
    const result = await convertImage(
      {
        bytes,
        format: job.format,
        pages: job.pages,
        engines,
        onProgress: (fraction) => reportProgress(jobId, fraction),
      },
      settings,
    ).catch((error: unknown) => {
      throw new Error(messageOf(error), { cause: error });
    });
    return Comlink.transfer(result, [result.bytes.buffer as ArrayBuffer]);
  },
};

export type ImageApi = typeof api;

Comlink.expose(api);
