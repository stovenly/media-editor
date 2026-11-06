<script lang="ts">
  import { theme } from '../../app/theme.svelte';
  import { Eye, Music } from '@lucide/svelte';
  import {
    laneCount,
    laneItems,
    videoDuration,
    type ItemKind,
    type VideoAsset,
    type VideoProject,
  } from '../../project/video';

  let {
    project,
    assets,
    pps,
    position,
    selected,
    onSeek,
    onSelect,
    onMove,
    onResize,
    onLane,
    soloView,
    soloHear,
    onSoloView,
    onSoloHear,
  }: {
    project: VideoProject;
    assets: ReadonlyMap<string, VideoAsset>;
    pps: number;
    position: number;
    selected: string | null;
    onSeek: (time: number) => void;
    onSelect: (id: string | null) => void;
    onMove: (id: string, start: number) => void;
    // `time` is where the dragged edge now is, in timeline seconds.
    onResize: (id: string, edge: 'start' | 'end', time: number) => void;
    // Called when a moved item is dropped, with its own layer if it stayed there. -1 for a new bottom
    // layer, laneCount for a new top one.
    onLane: (id: string, lane: number) => void;
    soloView: number | null; // the only layer shown in the preview, or null for all
    soloHear: number | null;
    onSoloView: (lane: number) => void;
    onSoloHear: (lane: number) => void;
  } = $props();

  const RULER = 22;
  const ROW = 44;
  const LABEL = 100;
  const EDGE = 7; // px either side of a block edge that grab it for resizing
  const SNAP = 6; // px within which a dragged edge jumps to another edge

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

  type Kind = ItemKind | 'cue';
  type Block = {
    id: string;
    kind: Kind;
    lane: number; // -1 for captions
    start: number;
    end: number;
    label: string;
    cut?: { start: boolean; end: boolean }; // trimmed short of the source at that edge
  };

  const lanes = $derived(Math.max(1, laneCount(project)));
  const captionsRow = $derived(project.captions.cues.length > 0);
  const rows = $derived(lanes + (captionsRow ? 1 : 0));
  const HEIGHT = $derived(RULER + rows * ROW + 4);
  const laneRows = $derived([...Array(laneCount(project)).keys()]);
  const rowOfLane = (lane: number) => (lane < 0 ? lanes : lanes - 1 - lane);

  const blocks = $derived.by((): Block[] => {
    const name = (id: string) => assets.get(id)?.name ?? '';
    const cut = ({ assetId, in: from, out }: { assetId: string; in: number; out: number }) => {
      const asset = assets.get(assetId);
      if (!asset || asset.kind === 'image') return undefined;
      return { start: from > 0.01, end: out < asset.duration - 0.01 };
    };
    const byId = new Map<string, { label: string; cut?: Block['cut'] }>();
    for (const c of project.main) byId.set(c.id, { label: name(c.assetId), cut: cut(c) });
    for (const o of project.overlay) byId.set(o.id, { label: name(o.assetId), cut: cut(o) });
    for (const m of project.music) byId.set(m.id, { label: name(m.assetId), cut: cut(m) });
    for (const t of project.texts) byId.set(t.id, { label: t.text.split('\n')[0] ?? '' });
    for (const r of project.redactions)
      byId.set(r.id, {
        label: r.kind === 'fill' ? 'Cover' : r.kind === 'blur' ? 'Blur' : 'Pixelate',
      });
    return [
      ...laneItems(project).map((i) => ({ ...i, ...byId.get(i.id)! })),
      ...project.captions.cues.map((c) => ({
        id: c.id,
        kind: 'cue' as const,
        lane: -1,
        start: c.start,
        end: c.end,
        label: c.text.split('\n')[0] ?? '',
      })),
    ];
  });

  const COLOURS: Record<Kind, string> = {
    clip: '',
    overlay: '#0ea5e9',
    text: '#d946ef',
    music: '#16a34a',
    redaction: '#64748b',
    cue: '#f59e0b',
  };

  // Read once per theme: getComputedStyle on every redraw forces a style recalculation mid-drag.
  let scheme = $state(0);
  $effect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const changed = () => scheme++;
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  });
  const palette = $derived.by(() => {
    void theme.choice;
    void scheme;
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    return {
      text: v('--text'),
      muted: v('--text-muted'),
      border: v('--border'),
      accent: v('--accent'),
      danger: v('--danger'),
    };
  });

  type Grab = 'move' | 'start' | 'end';
  // `playhead` is where it was when the drag began; trimming moves the playhead with the edge.
  let drag = $state<{
    block: Block;
    grab: Grab;
    offset: number;
    moved: boolean;
    playhead: number;
  } | null>(null);
  let drop = $state<number | null>(null); // layer a moved block would land on
  let hover = $state<string | null>(null);
  let guide = $state<number | null>(null); // timeline seconds of the active snap
  let cursor = $state('default');

  $effect(() => {
    if (!canvas) return;
    const dpr = devicePixelRatio || 1;
    const width = view.width;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, HEIGHT);
    const x = (t: number) => LABEL + t * pps - view.scroll;
    g.font = '11px Inter Variable, sans-serif';

    g.fillStyle = palette.muted;
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
    for (let row = 0; row < rows; row++) {
      const top = RULER + row * ROW;
      g.fillStyle = palette.border;
      g.fillRect(0, top + ROW - 1, width, 1);
      g.fillStyle = palette.muted;
      g.fillText(row < lanes ? `Layer ${lanes - row}` : 'Captions', 8, top + ROW / 2 + 4);
    }

    if (drag && drop !== null && (drop < 0 || drop >= laneCount(project))) {
      g.fillStyle = palette.accent;
      g.fillRect(LABEL, drop < 0 ? RULER + lanes * ROW - 2 : RULER - 2, width - LABEL, 3);
    }

    const colour = (kind: Kind) => (kind === 'clip' ? palette.accent : COLOURS[kind]);
    for (const b of blocks) {
      const left = Math.max(LABEL, x(b.start));
      const right = x(b.end);
      if (right < LABEL || left > width) continue;
      const moving = drag?.block.id === b.id && drop !== null;
      const row = moving && drop! >= 0 && drop! < lanes ? rowOfLane(drop!) : rowOfLane(b.lane);
      const top = RULER + row * ROW + 5;
      g.globalAlpha = b.id === selected ? 1 : 0.75;
      g.fillStyle = colour(b.kind);
      g.beginPath();
      g.roundRect(left, top, Math.max(2, right - left - 1), ROW - 10, 6);
      g.fill();
      if (b.id === selected) {
        g.strokeStyle = palette.text;
        g.lineWidth = 2;
        g.stroke();
      }
      if (b.cut?.start && x(b.start) >= LABEL) torn(g, left, top, 1);
      if (b.cut?.end) torn(g, right - 1, top, -1);
      if (b.id === selected || b.id === hover) {
        g.fillStyle = labelOn(colour(b.kind));
        g.globalAlpha = 0.7;
        const mid = top + (ROW - 10) / 2;
        if (x(b.start) >= LABEL) g.fillRect(left + 3, mid - 7, 2, 14);
        if (right - left > 14) g.fillRect(right - 7, mid - 7, 2, 14);
      }
      g.globalAlpha = 1;
      g.save();
      g.beginPath();
      g.rect(left, top, Math.max(0, right - left - 6), ROW - 10);
      g.clip();
      g.fillStyle = labelOn(colour(b.kind));
      g.fillText(b.label, left + 6, top + 14);
      g.fillText(`${(b.end - b.start).toFixed(1)} s`, left + 6, top + 28);
      g.restore();
    }
    if (guide !== null && x(guide) >= LABEL) {
      g.strokeStyle = palette.text;
      g.lineWidth = 1;
      g.setLineDash([4, 3]);
      g.beginPath();
      g.moveTo(Math.round(x(guide)) + 0.5, RULER);
      g.lineTo(Math.round(x(guide)) + 0.5, HEIGHT);
      g.stroke();
      g.setLineDash([]);
    }
    g.fillStyle = palette.danger;
    if (x(position) >= LABEL) g.fillRect(Math.round(x(position)) - 1, 0, 2, HEIGHT);
  });

  // Cuts a zigzag into the block edge at `edge`, so trimmed clips look torn off; `inward` is +1 for a left edge.
  function torn(g: CanvasRenderingContext2D, edge: number, top: number, inward: 1 | -1) {
    const tooth = 5;
    g.save();
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    const bottom = top + ROW - 10;
    g.moveTo(edge - inward * 2, top - 2);
    for (let y = top; y < bottom; y += tooth) {
      g.lineTo(edge, y);
      g.lineTo(edge + inward * 4, Math.min(bottom, y + tooth / 2));
    }
    g.lineTo(edge, bottom);
    g.lineTo(edge - inward * 2, bottom + 2);
    g.closePath();
    g.fill();
    g.restore();
  }

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

  function hit(event: PointerEvent): { block: Block; grab: Grab } | null {
    const { px, row, py } = locate(event);
    if (py < RULER) return null;
    const x = (t: number) => LABEL + t * pps - view.scroll;
    const candidates = blocks.filter(
      (b) => rowOfLane(b.lane) === row && px >= x(b.start) - EDGE && px <= x(b.end) + EDGE,
    );
    // The block under the pointer wins; a neighbour's edge only counts in the gap beside it.
    const inside = candidates.find((b) => px >= x(b.start) && px <= x(b.end));
    const order = inside ? [inside] : candidates;
    for (const block of order) {
      const left = x(block.start);
      const right = x(block.end);
      const narrow = right - left < EDGE * 3;
      if (!narrow && Math.abs(px - right) <= EDGE) return { block, grab: 'end' };
      if (!narrow && Math.abs(px - left) <= EDGE) return { block, grab: 'start' };
    }
    return inside ? { block: inside, grab: 'move' } : null;
  }

  function down(event: PointerEvent) {
    canvas!.setPointerCapture(event.pointerId);
    const { time } = locate(event);
    const found = hit(event);
    if (found) {
      const { block, grab } = found;
      onSelect(block.id);
      const edge = grab === 'end' ? block.end : block.start;
      drag = { block, grab, offset: time - edge, moved: false, playhead: position };
    } else {
      onSelect(null);
      onSeek(time);
    }
  }

  // The layer under the pointer: above the top layer makes a new top one, below the bottom a new bottom one.
  function laneAt(py: number): number {
    if (py < RULER) return laneCount(project);
    const row = Math.floor((py - RULER) / ROW);
    if (row >= lanes) return -1;
    return lanes - 1 - row;
  }

  function nearest(time: number): { target: number; distance: number } | null {
    const targets = [0, drag!.playhead];
    for (const b of blocks) if (b.id !== drag!.block.id) targets.push(b.start, b.end);
    let best: { target: number; distance: number } | null = null;
    for (const target of targets) {
      const distance = Math.abs(target - time) * pps;
      if (distance <= SNAP && (!best || distance < best.distance)) best = { target, distance };
    }
    return best;
  }

  function move(event: PointerEvent) {
    if (!drag) {
      const found = hit(event);
      hover = found?.block.id ?? null;
      cursor = !found ? 'default' : found.grab === 'move' ? 'grab' : 'ew-resize';
      return;
    }
    const { time, py } = locate(event);
    drag.moved = true;
    let at = Math.max(0, time - drag.offset);
    guide = null;
    if (drag.grab !== 'move') {
      const near = nearest(at);
      if (near) at = guide = near.target;
      onResize(drag.block.id, drag.grab, at);
      return;
    }
    const length = drag.block.end - drag.block.start;
    const head = nearest(at);
    const tail = nearest(at + length);
    if (head && (!tail || head.distance <= tail.distance)) at = guide = head.target;
    else if (tail) {
      guide = tail.target;
      at = Math.max(0, tail.target - length);
    }
    if (drag.block.kind !== 'cue') {
      const lane = laneAt(py);
      drop = lane === drag.block.lane ? null : lane;
    }
    onMove(drag.block.id, at);
  }

  function up(event: PointerEvent) {
    if (drag?.moved && drag.grab === 'move' && drag.block.kind !== 'cue')
      onLane(drag.block.id, drop ?? drag.block.lane);
    if (drag && !drag.moved) onSeek(locate(event).time);
    drag = null;
    drop = null;
    guide = null;
  }
</script>

<div
  bind:this={scroller}
  class="max-h-[45dvh] shrink-0 overflow-auto rounded-2xl border border-line bg-surface"
  onscroll={() => (view = { ...view, scroll: scroller.scrollLeft })}
>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="relative"
    style:width="{LABEL + duration * pps}px"
    style:height="{HEIGHT}px"
    role="application"
    tabindex="0"
    aria-label="Video timeline. Click to move the playhead. Drag items along a layer or between layers, above the top layer or below the bottom one to make a new layer, and drag their edges to change their length."
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointerleave={() => !drag && (hover = null)}
    style:cursor={drag ? (drag.grab === 'move' ? 'grabbing' : 'ew-resize') : cursor}
  >
    <canvas
      bind:this={canvas}
      class="sticky left-0 block touch-none"
      style:width="{view.width}px"
      style:height="{HEIGHT}px"
    ></canvas>
    <div class="absolute top-0" style:left="{view.scroll}px" style:width="{LABEL}px">
      {#each laneRows as row (row)}
        {@const lane = laneCount(project) - 1 - row}
        <div
          class="absolute right-1 flex items-center gap-0.5"
          style:top="{RULER + row * ROW + ROW / 2 - 12}px"
        >
          {#each [{ on: soloView === lane, label: 'Show only', Icon: Eye, toggle: onSoloView }, { on: soloHear === lane, label: 'Play the sound of only', Icon: Music, toggle: onSoloHear }] as button (button.label)}
            <button
              type="button"
              class="grid size-6 place-items-center rounded-md transition-colors {button.on
                ? 'bg-accent text-on-accent'
                : 'text-muted hover:bg-sunken hover:text-fg'}"
              aria-label="{button.label} layer {lane + 1}"
              aria-pressed={button.on}
              title="{button.label} layer {lane + 1}"
              onpointerdown={(e) => e.stopPropagation()}
              onclick={() => button.toggle(lane)}><button.Icon size={13} /></button
            >
          {/each}
        </div>
      {/each}
    </div>
  </div>
</div>
