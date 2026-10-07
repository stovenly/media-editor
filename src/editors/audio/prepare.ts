// Gets batch items ready for the audio editor: files the browser can't decode are converted to WAV first.
import { DEFAULT_OPTIONS } from '../../converter/options';
import { startJob } from '../../converter/run';
import type { FileItem } from '../../converter/files.svelte';

export function decodable(item: FileItem): boolean {
  const av = item.inspection?.av;
  return Boolean(av?.native && av.audio?.decodable);
}

export async function audioFileFor(item: FileItem): Promise<File> {
  if (decodable(item)) return item.file;
  const job = startJob({
    file: item.file,
    inspection: item.inspection!,
    targetId: 'wav',
    options: { ...DEFAULT_OPTIONS, metadata: 'none' },
    threads: 1,
    onTask: () => {},
  });
  const output = await job.result;
  return new File([output.blob], output.name, { type: 'audio/wav' });
}
