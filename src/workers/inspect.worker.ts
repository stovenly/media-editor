import * as Comlink from 'comlink';
import { convertSubtitles, inspect, readCues } from '../io/inspect';
import { attachProgress } from './progress';

// Which video codecs WebCodecs can encode here. Probed off the main thread: Chrome blocks on it for tens of milliseconds.
async function encodableVideoCodecs(probes: Record<string, string>): Promise<string[]> {
  if (typeof VideoEncoder === 'undefined') return [];
  const results = await Promise.all(
    Object.entries(probes).map(async ([id, codec]) => {
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec,
          width: 1280,
          height: 720,
          bitrate: 2_000_000,
        });
        return support.supported ? id : null;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((id): id is string => id !== null);
}

const api = {
  attach: attachProgress,
  inspect: (file: File) => inspect(file),
  convertSubtitles,
  readCues,
  encodableVideoCodecs,
};

export type InspectApi = typeof api;

Comlink.expose(api);
