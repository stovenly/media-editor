// Draws one frame of a video project onto a 2D canvas. Used for both preview and export.
import { fadeCurve } from '../audio/dsp';
import {
  IDENTITY,
  visualsAt,
  type ChromaKey,
  type TimedRedaction,
  type Transform,
  type VideoProject,
} from '../../project/video';
import { cueAt } from '../../captions/cues';
import type { Drawable } from './frames';
import { applyChromaKey } from './chroma';
import { drawText } from './text';

type Ctx = OffscreenCanvasRenderingContext2D;

// `use` names the clip or overlay asking, so each use of one file keeps its own decoder rather than one
// decoder seeking back and forth between them. `begin` is called before each frame's lookups.
export type FrameLookup = ((
  assetId: string,
  time: number,
  use: string,
) => Promise<Drawable | null>) & { begin?: () => void };

// Resolves once every named family can be drawn.
export type FontLoader = (families: ReadonlySet<string>) => Promise<void>;

export class Compositor {
  private oriented = new OffscreenCanvas(1, 1);
  private small = new OffscreenCanvas(1, 1);
  private keyed = new OffscreenCanvas(1, 1);

  constructor(
    private readonly ctx: Ctx,
    private readonly fonts: FontLoader = async () => {},
  ) {}

  // `scale` maps project pixels to canvas pixels (below 1 for a smaller preview).
  async draw(
    project: VideoProject,
    time: number,
    frames: FrameLookup,
    scale: number,
  ): Promise<void> {
    const ctx = this.ctx;
    const W = project.width * scale;
    const H = project.height * scale;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = project.background;
    ctx.fillRect(0, 0, W, H);

    const visuals = visualsAt(project, time);
    const cues = project.captions.burn ? cueAt(project.captions.cues, time) : [];
    const families = new Set<string>();
    for (const v of visuals) if (v.kind === 'text') families.add(v.text.style.font);
    if (cues.length) families.add(project.captions.style.font);
    if (families.size) await this.fonts(families);

    frames.begin?.();
    for (const v of visuals) {
      ctx.globalAlpha = 1;
      if (v.kind === 'clip') {
        const drawable = await frames(v.clip.assetId, v.source, v.clip.id);
        if (!drawable) continue;
        ctx.globalAlpha = fadeCurve(v.alpha);
        this.drawFitted(
          drawable,
          v.clip.transform,
          { x: 0, y: 0, width: W, height: H },
          project.fit,
          v.clip.key,
        );
      } else if (v.kind === 'overlay') {
        const drawable = await frames(v.overlay.assetId, v.source, v.overlay.id);
        if (!drawable) continue;
        ctx.globalAlpha = v.overlay.opacity;
        const r = v.overlay.rect;
        this.drawFitted(
          drawable,
          IDENTITY,
          { x: r.x * W, y: r.y * H, width: r.width * W, height: r.height * H },
          'contain',
          v.overlay.key,
        );
      } else if (v.kind === 'text') {
        const r = v.text.rect;
        drawText(ctx, v.text.text, v.text.style, W, H, fadeCurve(v.alpha), {
          x: r.x * W,
          y: r.y * H,
          width: r.width * W,
          height: r.height * H,
        });
      } else {
        this.redact(v.redaction, W, H);
      }
    }

    ctx.globalAlpha = 1;
    if (cues.length)
      drawText(ctx, cues.map((c) => c.text).join('\n'), project.captions.style, W, H);
    ctx.restore();
  }

  // Covers part of everything drawn so far.
  private redact(r: TimedRedaction, W: number, H: number) {
    const ctx = this.ctx;
    const x = Math.round(r.rect.x * W);
    const y = Math.round(r.rect.y * H);
    const w = Math.max(1, Math.round(r.rect.width * W));
    const h = Math.max(1, Math.round(r.rect.height * H));
    if (r.kind === 'fill') {
      ctx.fillStyle = r.color;
      ctx.fillRect(x, y, w, h);
    } else if (r.kind === 'blur') {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.filter = `blur(${Math.max(4, Math.min(w, h) / 6)}px)`;
      ctx.drawImage(ctx.canvas, x, y, w, h, x, y, w, h);
      ctx.restore();
    } else {
      const block = Math.max(4, Math.round(Math.min(w, h) / 8));
      const sw = Math.max(1, Math.round(w / block));
      const sh = Math.max(1, Math.round(h / block));
      this.small.width = sw;
      this.small.height = sh;
      const s = this.small.getContext('2d')!;
      s.drawImage(ctx.canvas, x, y, w, h, 0, 0, sw, sh);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.small, 0, 0, sw, sh, x, y, w, h);
      ctx.imageSmoothingEnabled = true;
    }
  }

  // Orients the frame (its own rotation plus the clip's), crops, then fits it into `box`.
  private drawFitted(
    d: Drawable,
    t: Transform,
    box: { x: number; y: number; width: number; height: number },
    fit: 'contain' | 'cover',
    key: ChromaKey | null = null,
  ) {
    const rotation = (((d.rotation + t.rotate) % 360) + 360) % 360;
    const sideways = rotation === 90 || rotation === 270;
    const ow = sideways ? d.height : d.width;
    const oh = sideways ? d.width : d.height;
    const canvas = this.oriented;
    if (canvas.width !== ow || canvas.height !== oh) {
      canvas.width = ow;
      canvas.height = oh;
    }
    const o = canvas.getContext('2d')!;
    o.save();
    o.clearRect(0, 0, ow, oh);
    o.translate(ow / 2, oh / 2);
    o.rotate((rotation * Math.PI) / 180);
    o.scale(t.flipH ? -1 : 1, t.flipV ? -1 : 1);
    o.drawImage(d.image, -d.width / 2, -d.height / 2, d.width, d.height);
    o.restore();

    const crop = t.crop ?? { x: 0, y: 0, width: 1, height: 1 };
    const sx = crop.x * ow;
    const sy = crop.y * oh;
    const sw = crop.width * ow;
    const sh = crop.height * oh;
    const scale =
      fit === 'contain'
        ? Math.min(box.width / sw, box.height / sh)
        : Math.max(box.width / sw, box.height / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = box.x + (box.width - dw) / 2;
    const dy = box.y + (box.height - dh) / 2;
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(box.x, box.y, box.width, box.height);
    this.ctx.clip();
    if (key) {
      // Keyed at the size it is drawn, which is cheaper than at the source size for a small preview.
      const w = Math.max(1, Math.round(dw));
      const h = Math.max(1, Math.round(dh));
      if (this.keyed.width !== w || this.keyed.height !== h) {
        this.keyed.width = w;
        this.keyed.height = h;
      }
      const k = this.keyed.getContext('2d', { willReadFrequently: true })!;
      k.clearRect(0, 0, w, h);
      k.drawImage(canvas, sx, sy, sw, sh, 0, 0, w, h);
      const pixels = k.getImageData(0, 0, w, h);
      applyChromaKey(pixels.data, key);
      k.putImageData(pixels, 0, 0);
      this.ctx.drawImage(this.keyed, dx, dy, dw, dh);
    } else {
      this.ctx.drawImage(canvas, sx, sy, sw, sh, dx, dy, dw, dh);
    }
    this.ctx.restore();
  }
}
