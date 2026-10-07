<script lang="ts" module>
  export type MovableRow = 'overlay' | 'text' | 'cue' | 'music';
</script>

<script lang="ts">
  import { layout, videoDuration, type VideoAsset, type VideoProject } from '../../project/video';

  let {
    project,
    assets,
    pps,
    position,
    selected,
    onSeek,
    onSelect,
    onReorder,
    onMove,
  }: {
    project: VideoProject;
    assets: ReadonlyMap<string, VideoAsset>;
    pps: number;
    position: number;
    selected: string | null;
    onSeek: (time: number) => void;
    onSelect: (id: string | null) => void;
    onReorder: (id: string, index: number) => void;
    onMove: (row: MovableRow, id: string, start: number) => void;
  } = $props();

  const RULER = 22;
  const ROW = 44;
  const ROWS = ['Video', 'Overlay', 'Text', 'Captions', 'Music'] as const;
  const HEIGHT = RULER + ROWS.length * ROW + 4;
  const LABEL = 64;

  let scroller: HTMLDivElement;
  let canvas = $state<HTMLCanvasElement>();
  let view = $state({ width: 0, scroll: 0 });
  const duration = $derived(Math.max(videoDuration(project) + 5, 20));

  $effect(() => {
    const observer = new ResizeObserver(
      ([e]) => e && (view = { ...view, width: e.contentRect.width }),
    );
    observer.observe(scroller);
    return () => observer.disconnect();
  });

  type Block = {
    id: string;
    row: number;
    start: number;
    end: number;
    label: string;
    index?: number;
  };

  const blocks = $derived.by((): Block[] => {
    const name = (id: string) => assets.get(id)?.name ?? '';
    return [
      ...layout(project).map(({ clip, start, end }, index) => ({
        id: clip.id,
        row: 0,
        start,
        end,
        label: name(clip.assetId),
        index,
      })),
      ...project.overlay.map((o) => ({
        id: o.id,
        row: 1,
        start: o.start,
        end: o.start + (o.out - o.in),
        label: name(o.assetId),
      })),
      ...project.texts.map((t) => ({
        id: t.id,
        row: 2,
        start: t.start,
        end: t.start + t.duration,
        label: t.text.split('\n')[0] ?? '',
      })),
      ...project.captions.cues.map((c) => ({
        id: c.id,
        row: 3,
        start: c.start,
        end: c.end,
        label: c.text.split('\n')[0] ?? '',
      })),
      ...project.music.map((m) => ({
        id: m.id,
        row: 4,
        start: m.start,
        end: m.start + (m.out - m.in),
        label: name(m.assetId),
      })),
    ];
  });

  $effect(() => {
    if (!canvas) return;
    const dpr = devicePixelRatio || 1;
    const width = view.width;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, HEIGHT);
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    const x = (t: number) => LABEL + t * pps - view.scroll;
    g.font = '11px Inter Variable, sans-serif';

    g.fillStyle = v('--text-muted');
    const step = pps > 60 ? 1 : pps > 20 ? 5 : pps > 6 ? 10 : 30;
    for (let t = Math.floor(view.scroll / pps / step) * step; x(t) < width; t += step) {
      if (x(t) < LABEL) continue;
      g.fillRect(Math.round(x(t)), RULER - 5, 1, 5);
      g.fillText(
        `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`,
        x(t) + 3,
        11,
      );
    }
    ROWS.forEach((label, row) => {
      const top = RULER + row * ROW;
      g.fillStyle = v('--border');
      g.fillRect(0, top + ROW - 1, width, 1);
      g.fillStyle = v('--text-muted');
      g.fillText(label, 8, top + ROW / 2 + 4);
    });
    const colours = [v('--accent'), '#0ea5e9', '#d946ef', '#f59e0b', '#16a34a'];
    for (const b of blocks) {
      const left = Math.max(LABEL, x(b.start));
      const right = x(b.end);
      if (right < LABEL || left > width) continue;
      const top = RULER + b.row * ROW + 5;
      g.globalAlpha = b.id === selected ? 1 : 0.75;
      g.fillStyle = colours[b.row]!;
      g.beginPath();
      g.roundRect(left, top, Math.max(2, right - left - 1), ROW - 10, 6);
      g.fill();
      if (b.id === selected) {
        g.strokeStyle = v('--text');
        g.lineWidth = 2;
        g.stroke();
      }
      g.globalAlpha = 1;
      g.save();
      g.beginPath();
      g.rect(left, top, Math.max(0, right - left - 6), ROW - 10);
      g.clip();
      g.fillStyle = labelOn(colours[b.row]!);
      g.fillText(b.label, left + 6, top + 14);
      g.fillText(`${(b.end - b.start).toFixed(1)} s`, left + 6, top + 28);
      g.restore();
    }
    g.fillStyle = v('--danger');
    if (x(position) >= LABEL) g.fillRect(Math.round(x(position)) - 1, 0, 2, HEIGHT);
  });

  const MOVABLE: (MovableRow | undefined)[] = [undefined, 'overlay', 'text', 'cue', 'music'];
  // Black or white, whichever reads better on a #rrggbb fill.
  function labelOn(fill: string): string {
    const hex = /^#([0-9a-f]{6})$/i.exec(fill.trim())?.[1];
    if (!hex) return '#ffffff';
    const [r, g, b] = [0, 2, 4].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.18 ? '#000000' : '#ffffff';
  }

  let drag: { block: Block; grab: number; moved: boolean } | null = null;

  function locate(event: PointerEvent) {
    const bounds = canvas!.getBoundingClientRect();
    const px = event.clientX - bounds.left;
    const py = event.clientY - bounds.top;
    return {
      time: Math.max(0, (px - LABEL + view.scroll) / pps),
      row: Math.floor((py - RULER) / ROW),
      px,
      py,
    };
  }

  function down(event: PointerEvent) {
    canvas!.setPointerCapture(event.pointerId);
    const { time, row, py } = locate(event);
    const block =
      py >= RULER
        ? blocks.find((b) => b.row === row && time >= b.start && time <= b.end)
        : undefined;
    if (block) {
      onSelect(block.id);
      drag = { block, grab: time - block.start, moved: false };
    } else {
      onSelect(null);
      onSeek(time);
    }
  }

  function move(event: PointerEvent) {
    if (!drag) return;
    const { time } = locate(event);
    drag.moved = true;
    const row = MOVABLE[drag.block.row];
    if (row) onMove(row, drag.block.id, Math.max(0, time - drag.grab));
  }

  function up(event: PointerEvent) {
    if (drag?.moved && drag.block.row === 0) {
      const { time } = locate(event);
      const main = blocks.filter((b) => b.row === 0 && b.id !== drag!.block.id);
      const index = main.filter((b) => (b.start + b.end) / 2 < time).length;
      onReorder(drag.block.id, index);
    }
    if (drag && !drag.moved) onSeek(locate(event).time);
    drag = null;
  }
</script>

<div
  bind:this={scroller}
  class="overflow-x-auto rounded-2xl border border-line bg-surface"
  onscroll={() => (view = { ...view, scroll: scroller.scrollLeft })}
>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    style:width="{LABEL + duration * pps}px"
    style:height="{HEIGHT}px"
    role="application"
    tabindex="0"
    aria-label="Video timeline. Click to move the playhead, drag clips to reorder or move them. Arrow keys step through frames; [ and ] select the previous or next item."
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
  >
    <canvas
      bind:this={canvas}
      class="sticky top-0 left-0 block touch-none"
      style:width="{view.width}px"
      style:height="{HEIGHT}px"
    ></canvas>
  </div>
</div>
