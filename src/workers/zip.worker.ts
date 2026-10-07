import * as Comlink from 'comlink';
import { makeZip, type ZipEntry } from '../io/zip';
import { attachProgress } from './progress';

const api = {
  attach: attachProgress,
  async zip(entries: ZipEntry[]): Promise<Blob> {
    const bytes = await makeZip(entries);
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
  },
};

export type ZipApi = typeof api;

Comlink.expose(api);
