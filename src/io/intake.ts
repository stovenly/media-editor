// Turns drops, pastes and pickers into a flat list of files, walking dropped folders.

const isHidden = (name: string) => name.startsWith('.');

// Entries must be taken synchronously inside the drop handler: the
// DataTransfer is emptied as soon as the handler returns.
export function filesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
  const entries: FileSystemEntry[] = [];
  const loose: File[] = [];
  for (const item of dataTransfer.items) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
    else {
      const file = item.getAsFile();
      if (file) loose.push(file);
    }
  }
  if (entries.length === 0 && loose.length === 0) return Promise.resolve([...dataTransfer.files]);
  return Promise.all(entries.map(walk)).then((nested) => [...loose, ...nested.flat()]);
}

export function filesFromPaste(event: ClipboardEvent): File[] {
  return [...(event.clipboardData?.files ?? [])];
}

async function walk(entry: FileSystemEntry): Promise<File[]> {
  if (isHidden(entry.name)) return [];
  if (entry.isFile) return [await fileOf(entry as FileSystemFileEntry)];
  if (!entry.isDirectory) return [];
  const children = await readAll((entry as FileSystemDirectoryEntry).createReader());
  return (await Promise.all(children.map(walk))).flat();
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

// readEntries returns at most 100 entries per call; an empty batch means done.
async function readAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}
