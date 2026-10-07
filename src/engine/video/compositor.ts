// Draws one frame of a video project onto a 2D canvas. Used for both preview and export.
import { fadeCurve } from '../audio/dsp';
import { mainAt, mainLength, type Transform, type VideoProject } from '../../project/video';
import type { Drawable } from './frames';

type Ctx = OffscreenCanvasRenderingContext2D;

export type FrameLookup = (assetId: string, time: number) => Promise<Drawable | null>;

export class Compositor {
  private oriented = new OffscreenCanvas(1, 1);
  private small = new OffscreenCanvas(1, 1);

  constructor(private readonly ctx: Ctx) {}

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

    for (const { clip, source, alpha } of mainAt(project, time)) {
      const drawable = await frames(clip.assetId, source);
      if (!drawable) continue;
      const local = (source - clip.in) / clip.speed;
      const length = mainLength(clip);
      let fade = 1;
      if (clip.fadeIn > 0 && local < clip.fadeIn) fade *= fadeCurve(local / clip.fadeIn);
      if (clip.fadeOut > 0 && local > length - clip.fadeOut)
        fade *= fadeCurve((length - local) / clip.fadeOut);
      ctx.globalAlpha = alpha * fade;
      this.drawFitted(drawable, clip.transform, { x: 0, y: 0, width: W, height: H }, project.fit);
    }

    for (const overlay of project.overlay) {
      const local = time - overlay.start;
      if (local < 0 || local >= overlay.out - overlay.in) continue;
      const drawable = await frames(overlay.assetId, overlay.in + local);
      if (!drawable) continue;
      ctx.globalAlpha = overlay.opacity;
      const rect = {
        x: overlay.rect.x * W,
        y: overlay.rect.y * H,
        width: overlay.rect.width * W,
        height: overlay.rect.height * H,
      };
      this.drawFitted(
        drawable,
        { crop: null, rotate: 0, flipH: false, flipV: false },
        rect,
        'contain',
      );
    }

    ctx.globalAlpha = 1;
    for (const r of project.redactions) {
      if (time < r.from || time >= r.to) continue;
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
    ctx.restore();
  }

  // Orients the frame (its own rotation plus the clip's), crops, then fits it into `box`.
  private drawFitted(
    d: Drawable,
    t: Transform,
    box: { x: number; y: number; width: number; height: number },
    fit: 'contain' | 'cover',
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
    this.ctx.drawImage(canvas, sx, sy, sw, sh, dx, dy, dw, dh);
    this.ctx.restore();
  }
}
