// Fetches engine files on the main thread so the first use can show its download size and progress.
// Workers then load the same URLs from the service worker's cache.
export type EngineName = 'vips' | 'magick' | 'ffmpeg';

type Manifest = Record<EngineName, { dir: string; files: Record<string, number> }>;

export type Download = { engine: EngineName; loaded: number; total: number };

export const ENGINE_LABELS: Record<EngineName, string> = {
  vips: 'image engine',
  magick: 'extra image formats',
  ffmpeg: 'video engine',
};

const base = import.meta.env.BASE_URL;
let manifest: Promise<Manifest> | undefined;

export function engineManifest(): Promise<Manifest> {
  manifest ??= fetch(`${base}wasm/manifest.json`).then((response) => {
    if (!response.ok) throw new Error('The engine list could not be loaded');
    return response.json() as Promise<Manifest>;
  });
  return manifest;
}

export function engineUrl(dir: string, file: string): string {
  return new URL(`${base}wasm/${dir}/${file}`, location.href).href;
}

class Downloads {
  active = $state.raw<readonly Download[]>([]);
  private ready = new Map<EngineName, Promise<string>>();

  // Resolves to the engine's directory URL once every file is cached.
  ensure(engine: EngineName): Promise<string> {
    let promise = this.ready.get(engine);
    if (!promise) {
      promise = this.fetchAll(engine);
      this.ready.set(engine, promise);
      promise.catch(() => this.ready.delete(engine));
    }
    return promise;
  }

  private async fetchAll(engine: EngineName): Promise<string> {
    const entry = (await engineManifest())[engine];
    const files = Object.entries(entry.files);
    const total = files.reduce((sum, [, size]) => sum + size, 0);
    let loaded = 0;
    let shown = false;
    let lastShown = 0;
    const show = () => {
      lastShown = performance.now();
      const rest = this.active.filter((download) => download.engine !== engine);
      this.active = [...rest, { engine, loaded, total }];
    };
    const timer = setTimeout(() => ((shown = true), show()), 300);
    try {
      await Promise.all(
        files.map(async ([file]) => {
          const response = await fetch(engineUrl(entry.dir, file));
          if (!response.ok || !response.body)
            throw new Error(`Couldn't download the ${ENGINE_LABELS[engine]}`);
          const reader = response.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            loaded += value.byteLength;
            if (shown && performance.now() - lastShown > 100) show();
          }
        }),
      );
    } finally {
      clearTimeout(timer);
      this.active = this.active.filter((download) => download.engine !== engine);
    }
    return engineUrl(entry.dir, '');
  }
}

export const downloads = new Downloads();
