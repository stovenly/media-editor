// Files that arrive from the operating system: "Open with" (File Handling API) and the Android share sheet.
const SHARE_CACHE = 'shared-files';

type LaunchParams = { files: FileSystemFileHandle[] };
type LaunchQueue = { setConsumer(consumer: (params: LaunchParams) => void): void };

export function receiveLaunchedFiles(onFiles: (files: File[]) => void): void {
  const queue = (window as Window & { launchQueue?: LaunchQueue }).launchQueue;
  queue?.setConsumer((params) => {
    if (params.files.length)
      void Promise.all(params.files.map((handle) => handle.getFile())).then(onFiles);
  });

  const url = new URL(location.href);
  if (!url.searchParams.has('shared')) return;
  url.searchParams.delete('shared');
  history.replaceState(null, '', url);
  void takeShared().then((files) => files.length && onFiles(files));
}

async function takeShared(): Promise<File[]> {
  if (!('caches' in window)) return [];
  const cache = await caches.open(SHARE_CACHE);
  const requests = await cache.keys();
  const files = await Promise.all(
    requests.map(async (request) => {
      const response = await cache.match(request);
      await cache.delete(request);
      if (!response) return null;
      const name = decodeURIComponent(response.headers.get('X-File-Name') ?? 'shared');
      const blob = await response.blob();
      return new File([blob], name, { type: blob.type });
    }),
  );
  return files.filter((file) => file !== null);
}
