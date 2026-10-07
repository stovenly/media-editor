// Draws styled, wrapped text onto a 2D canvas. Text clips and burned-in captions both come through here.
import type { TextStyle } from '../../project/text';

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export function fontString(style: TextStyle, px: number): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? 700 : 400} ${px}px "${style.font}", sans-serif`;
}

export function wrapLines(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/(\s+)/).filter((w) => w.length > 0);
    let line = '';
    for (const word of words) {
      const next = line + word;
      if (line.trim() && ctx.measureText(next.trimEnd()).width > maxWidth && word.trim()) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else {
        line = next;
      }
    }
    lines.push(line.trim());
  }
  return lines;
}

// `width` and `height` are the frame in canvas pixels; `alpha` multiplies everything drawn.
export function drawText(
  ctx: Ctx,
  text: string,
  style: TextStyle,
  width: number,
  height: number,
  alpha = 1,
): void {
  if (!text.trim() || alpha <= 0) return;
  const px = Math.max(1, style.size * height);
  const margin = style.margin * Math.min(width, height);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = fontString(style, px);
  ctx.textBaseline = 'middle';
  const lines = wrapLines(ctx, text, Math.max(px, width - 2 * margin));
  const lineHeight = px * 1.25;
  const blockHeight = lines.length * lineHeight;

  const [vertical, horizontal] = place(style.anchor);
  const align = horizontal === 'left' ? 'left' : horizontal === 'right' ? 'right' : 'center';
  ctx.textAlign = align;
  const x = align === 'left' ? margin : align === 'right' ? width - margin : width / 2;
  const top =
    vertical === 'top'
      ? margin
      : vertical === 'bottom'
        ? height - margin - blockHeight
        : (height - blockHeight) / 2;

  const pad = px * 0.28;
  lines.forEach((line, i) => {
    if (!line) return;
    const y = top + i * lineHeight + lineHeight / 2;
    const w = ctx.measureText(line).width;
    if (style.box) {
      const left = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
      ctx.fillStyle = style.box;
      ctx.beginPath();
      ctx.roundRect(left - pad, y - lineHeight / 2, w + 2 * pad, lineHeight, px * 0.12);
      ctx.fill();
    }
    if (style.outline > 0) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = style.outline * px * 2;
      ctx.strokeStyle = style.outlineColor;
      ctx.strokeText(line, x, y);
    }
    if (style.shadow) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = px * 0.15;
      ctx.shadowOffsetY = px * 0.05;
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, x, y);
    ctx.shadowColor = 'transparent';
  });
  ctx.restore();
}

function place(
  anchor: TextStyle['anchor'],
): ['top' | 'middle' | 'bottom', 'left' | 'center' | 'right'] {
  const vertical = anchor.startsWith('top')
    ? 'top'
    : anchor.startsWith('bottom')
      ? 'bottom'
      : 'middle';
  const horizontal = anchor.endsWith('left')
    ? 'left'
    : anchor.endsWith('right')
      ? 'right'
      : 'center';
  return [vertical, horizontal];
}
