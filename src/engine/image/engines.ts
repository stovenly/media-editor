// Lazily started image engines inside an image worker. `dir` is the engine's vendored directory URL.
import type VipsFactory from 'wasm-vips';
import type * as MagickModule from '@imagemagick/magick-wasm';

export type Vips = Awaited<ReturnType<typeof VipsFactory>>;
export type Magick = typeof MagickModule;

let vips: Promise<Vips> | undefined;
let magick: Promise<Magick> | undefined;

export function loadVips(dir: string, threads: number): Promise<Vips> {
  vips ??= (async () => {
    const module = (await import(/* @vite-ignore */ `${dir}vips-es6.js`)) as {
      default: typeof VipsFactory;
    };
    const instance = await module.default({
      locateFile: (file: string) => dir + file,
      dynamicLibraries: ['vips-jxl.wasm', 'vips-heif.wasm', 'vips-resvg.wasm'],
      print: () => {},
      printErr: () => {},
    });
    instance.Cache.max(0);
    return instance;
  })();
  vips.catch(() => (vips = undefined));
  return vips.then((instance) => {
    instance.concurrency(threads);
    return instance;
  });
}

export function loadMagick(dir: string): Promise<Magick> {
  magick ??= (async () => {
    const module = await import('@imagemagick/magick-wasm');
    await module.initializeImageMagick(new URL(`${dir}magick.wasm`));
    return module;
  })();
  magick.catch(() => (magick = undefined));
  return magick;
}
