// One image editing session: the decoded source and a downscaled proxy stay in memory between renders.
import * as Comlink from 'comlink';
import { decode } from '../engine/image/convert';
import { applyEdit } from '../engine/image/edit';
import { loadMagick, loadVips, type Vips } from '../engine/image/engines';
import { planImage } from '../engine/image/router';
import { Scope, toSrgbAlpha, type VImage } from '../engine/image/vips-util';
import { messageOf } from '../engine/errors';
import { EMPTY_EDIT, type ImageEdit } from '../project/image-edit';

const PROXY_EDGE = 1600;

type Session = { vips: Vips; source: VImage; proxy: VImage; scale: number };

let session: Session | null = null;

export type Stage = 'geometry' | 'full' | 'original';

const api = {
  async open(
    file: File,
    format: string,
    dirs: { vips: string; magick?: string },
    threads: number,
  ): Promise<{ width: number; height: number }> {
    try {
      api.close();
      const vips = await loadVips(dirs.vips, threads);
      const plan = planImage({ format, pages: 1 }, 'png');
      const magick =
        plan.decoder === 'vips'
          ? undefined
          : dirs.magick
            ? await loadMagick(dirs.magick)
            : undefined;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const engines = { vips: async () => vips, magick: async () => magick! };
      const decoded = await decode(
        vips,
        magick,
        { bytes, format, pages: 1, engines, onProgress: () => {} },
        plan,
        [],
      );
      const source = decoded.copyMemory();
      decoded.delete();
      const scale = Math.min(1, PROXY_EDGE / Math.max(source.width, source.height));
      const resized = scale < 1 ? source.resize(scale, { kernel: 'lanczos3' }) : source.copy();
      const proxy = resized.copyMemory();
      resized.delete();
      session = { vips, source, proxy, scale: proxy.width / source.width };
      return { width: source.width, height: source.height };
    } catch (error) {
      throw new Error(messageOf(error), { cause: error });
    }
  },

  async render(edit: ImageEdit, stage: Stage): Promise<ImageBitmap> {
    if (!session) throw new Error('No image is open');
    const { vips, proxy, scale } = session;
    const scope = new Scope();
    scope.keep(proxy);
    try {
      const shown: ImageEdit =
        stage === 'original'
          ? EMPTY_EDIT
          : stage === 'geometry'
            ? { ...edit, crop: null, redactions: [], resize: null, pad: null }
            : { ...edit, resize: null };
      const edited = applyEdit(vips, scope, proxy, shown, scale);
      const rgba = scope.track(toSrgbAlpha(scope, edited));
      const pixels = rgba.writeToMemory();
      const data = new ImageData(new Uint8ClampedArray(pixels), rgba.width, rgba.height);
      const bitmap = await createImageBitmap(data);
      return Comlink.transfer(bitmap, [bitmap]);
    } catch (error) {
      throw new Error(messageOf(error), { cause: error });
    } finally {
      scope.dispose();
    }
  },

  close(): void {
    session?.source.delete();
    session?.proxy.delete();
    session = null;
  },
};

export type EditorApi = typeof api;

Comlink.expose(api);
