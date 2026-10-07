import { downloadZip } from 'client-zip';

export type ZipEntry = { name: string; bytes: Uint8Array | Blob };

export async function makeZip(entries: readonly ZipEntry[]): Promise<Uint8Array> {
  const used = new Set<string>();
  const files = entries.map((entry) => ({
    name: uniqueName(entry.name, used),
    input: entry.bytes,
    lastModified: new Date(),
  }));
  return new Uint8Array(await downloadZip(files).arrayBuffer());
}

export function uniqueName(name: string, used: Set<string>): string {
  let candidate = name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}
