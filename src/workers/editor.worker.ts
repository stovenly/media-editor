// One image editing session: the decoded source and a downscaled proxy stay in memory between renders.
import * as Comlink from 'comlink';
import { decode } from '../engine/image/convert';
import { applyEdit } from '../engine/image/edit';
import { loadMagick, loadVips, type Vips } from '../engine/image/engines';
import { planImage } from '../engine/image/router';
import { Scope, toSrgbAlpha, type VImage } from '../engine/image/vips-util';
import { messageOf } from '../engine/errors';
import { EMPTY_EDIT, type ImageEdit, type Rect } from '../project/image-edit';

const PROXY_EDGE = 1600;

type Session = { vips: Vips; source: VImage; proxy: VImage; scale: number };

let session: Session | null = null;

export type Stage = 'geometry' | 'full' | 'original';

function shownFor(edit: ImageEdit, stage: Stage): ImageEdit {
  return stage === 'original'
    ? EMPTY_EDIT
    : stage === 'geometry'
      ? { ...edit, crop: null, redactions: [], resize: null, pad: null }
      : { ...edit, resize: null };
}

async function toBitmap(scope: Scope, image: VImage): Promise<ImageBitmap> {
  const rgba = scope.track(toSrgbAlpha(scope, image));
  const pixels = rgba.writeToMemory();
  const data = new ImageData(new Uint8ClampedArray(pixels), rgba.width, rgba.height);
  const bitmap = await createImageBitmap(data);
  return Comlink.transfer(bitmap, [bitmap]);
}

const api = {
  async open(
    file: File,
    format: string,
    dirs: { vips: string; magick?: string },
    threads: number,
  ): Promise<{ width: number; height: number; scale: number }> {
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
      return { width: source.width, height: source.height, scale: session.scale };
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
      return await toBitmap(scope, applyEdit(vips, scope, proxy, shownFor(edit, stage), scale));
    } catch (error) {
      throw new Error(messageOf(error), { cause: error });
    } finally {
      scope.dispose();
    }
  },

  // `region` is a fraction of the edited image; the result is at most `width`×`height` pixels.
  async detail(
    edit: ImageEdit,
    stage: Stage,
    region: Rect,
    width: number,
    height: number,
  ): Promise<ImageBitmap> {
    if (!session) throw new Error('No image is open');
    const { vips, source } = session;
    const scope = new Scope();
    scope.keep(source);
    try {
      const edited = applyEdit(vips, scope, source, shownFor(edit, stage), 1);
      const left = Math.max(0, Math.min(edited.width - 1, Math.floor(region.x * edited.width)));
      const top = Math.max(0, Math.min(edited.height - 1, Math.floor(region.y * edited.height)));
      const w = Math.max(1, Math.min(edited.width - left, Math.ceil(region.width * edited.width)));
      const h = Math.max(
        1,
        Math.min(edited.height - top, Math.ceil(region.height * edited.height)),
      );
      let area = scope.track(edited.extractArea(left, top, w, h));
      const fit = Math.min(1, width / w, height / h);
      if (fit < 1) area = scope.track(area.resize(fit, { kernel: 'lanczos3' }));
      return await toBitmap(scope, area);
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
