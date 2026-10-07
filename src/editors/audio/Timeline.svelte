<script lang="ts">
  import { clipEnd, projectDuration, type AudioClip, type AudioProject } from '../../project/audio';
  import { PEAKS_PER_SECOND } from './session.svelte';

  export type Selection = { from: number; to: number; trackId: string | null } | null;

  let {
    project,
    peaks,
    pps,
    position,
    selection,
    selectedClip,
    onSeek,
    onSelect,
    onSelectClip,
    onMove,
    onTrim,
  }: {
    project: AudioProject;
    peaks: ReadonlyMap<string, Float32Array>;
    pps: number; // pixels per second
    position: number;
    selection: Selection;
    selectedClip: string | null;
    onSeek: (time: number) => void;
    onSelect: (selection: Selection) => void;
    onSelectClip: (clipId: string | null) => void;
    onMove: (clipId: string, start: number, trackId: string) => void;
    onTrim: (clipId: string, edge: 'start' | 'end', time: number) => void;
  } = $props();

  const RULER = 24;
  const TRACK = 76;
  const EDGE = 6;

  let scroller: HTMLDivElement;
  let canvas = $state<HTMLCanvasElement>();
  let view = $state({ width: 0, scroll: 0 });

  const duration = $derived(Math.max(projectDuration(project) + 5, 30));
  const height = $derived(RULER + project.tracks.length * TRACK + 8);

  $effect(() => {
    const observer = new ResizeObserver(
      ([entry]) => entry && (view = { ...view, width: entry.contentRect.width }),
    );
    observer.observe(scroller);
    return () => observer.disconnect();
  });

  const styles = () => {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    return {
      line: v('--border'),
      muted: v('--text-muted'),
      text: v('--text'),
      accent: v('--accent'),
      raised: v('--surface-raised'),
      soft: v('--accent-soft'),
    };
  };

  $effect(() => {
    if (!canvas) return;
    const dpr = devicePixelRatio || 1;
    const width = view.width;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const c = styles();
    const x = (t: number) => t * pps - view.scroll;

    g.fillStyle = c.muted;
    g.font = '11px Inter Variable, sans-serif';
    const step = pps > 120 ? 1 : pps > 40 ? 5 : pps > 12 ? 10 : 30;
    for (let t = Math.floor(view.scroll / pps / step) * step; x(t) < width; t += step) {
      g.fillRect(Math.round(x(t)), RULER - 6, 1, 6);
      g.fillText(
        `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`,
        x(t) + 3,
        12,
      );
    }

    project.tracks.forEach((track, index) => {
      const top = RULER + index * TRACK;
      g.fillStyle = c.line;
      g.fillRect(0, top + TRACK - 1, width, 1);
      for (const clip of track.clips) drawClip(g, clip, top, x, c, track.muted);
    });

    if (selection && selection.to > selection.from) {
      g.fillStyle = c.accent;
      g.globalAlpha = 0.15;
      const index = selection.trackId
        ? project.tracks.findIndex((t) => t.id === selection.trackId)
        : -1;
      const top = index >= 0 ? RULER + index * TRACK : RULER;
      const h = index >= 0 ? TRACK : project.tracks.length * TRACK;
      g.fillRect(x(selection.from), top, (selection.to - selection.from) * pps, h);
      g.globalAlpha = 1;
    }

    g.fillStyle = c.accent;
    g.fillRect(Math.round(x(position)) - 1, 0, 2, height);
  });

  function drawClip(
    g: CanvasRenderingContext2D,
    clip: AudioClip,
    top: number,
    x: (t: number) => number,
    c: ReturnType<typeof styles>,
    muted: boolean,
  ) {
    const left = x(clip.start);
    const right = x(clipEnd(clip));
    if (right < 0 || left > view.width) return;
    const y = top + 6;
    const h = TRACK - 12;
    g.globalAlpha = muted ? 0.4 : 1;
    g.fillStyle = clip.id === selectedClip ? c.soft : c.raised;
    g.strokeStyle = clip.id === selectedClip ? c.accent : c.line;
    g.lineWidth = clip.id === selectedClip ? 2 : 1;
    g.beginPath();
    g.roundRect(left, y, right - left, h, 6);
    g.fill();
    g.stroke();
    const data = peaks.get(clip.assetId);
    if (data) {
      g.save();
      g.beginPath();
      g.rect(left, y, right - left, h);
      g.clip();
      g.fillStyle = c.accent;
      const mid = y + h / 2;
      const from = Math.max(left, 0);
      const to = Math.min(right, view.width);
      for (let px = Math.floor(from); px < to; px++) {
        const t0 = clip.in + (px - left) / pps;
        const t1 = t0 + 1 / pps;
        const b0 = Math.max(0, Math.floor(t0 * PEAKS_PER_SECOND));
        const b1 = Math.min(data.length / 2, Math.max(b0 + 1, Math.ceil(t1 * PEAKS_PER_SECOND)));
        let min = 0;
        let max = 0;
        for (let b = b0; b < b1; b++) {
          min = Math.min(min, data[b * 2]!);
          max = Math.max(max, data[b * 2 + 1]!);
        }
        const gain = clip.gain;
        g.fillRect(px, mid - max * gain * (h / 2), 1, Math.max(1, (max - min) * gain * (h / 2)));
      }
      g.restore();
    }
    g.strokeStyle = c.text;
    g.lineWidth = 1;
    if (clip.fadeIn > 0) {
      g.beginPath();
      g.moveTo(left, y + h);
      g.lineTo(left + clip.fadeIn * pps, y);
      g.stroke();
    }
    if (clip.fadeOut > 0) {
      g.beginPath();
      g.moveTo(right - clip.fadeOut * pps, y);
      g.lineTo(right, y + h);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  type Drag =
    | { kind: 'move'; clip: AudioClip; grab: number; trackId: string }
    | { kind: 'trim'; clip: AudioClip; edge: 'start' | 'end' }
    | { kind: 'select'; from: number; trackId: string | null };
  let drag: Drag | null = null;

  function locate(event: PointerEvent) {
    const bounds = canvas!.getBoundingClientRect();
    const px = event.clientX - bounds.left;
    const py = event.clientY - bounds.top;
    const time = Math.max(0, (px + view.scroll) / pps);
    const index = Math.floor((py - RULER) / TRACK);
    const track = py >= RULER ? project.tracks[index] : undefined;
    return { px, py, time, track };
  }

  function down(event: PointerEvent) {
    canvas!.setPointerCapture(event.pointerId);
    const { px, time, track } = locate(event);
    const clip = track?.clips.find((c) => time >= c.start && time <= clipEnd(c));
    if (track && clip) {
      onSelectClip(clip.id);
      const left = clip.start * pps - view.scroll;
      const right = clipEnd(clip) * pps - view.scroll;
      if (px - left < EDGE) drag = { kind: 'trim', clip, edge: 'start' };
      else if (right - px < EDGE) drag = { kind: 'trim', clip, edge: 'end' };
      else drag = { kind: 'move', clip, grab: time - clip.start, trackId: track.id };
      return;
    }
    onSelectClip(null);
    onSeek(time);
    onSelect(null);
    drag = { kind: 'select', from: time, trackId: track?.id ?? null };
  }

  function move(event: PointerEvent) {
    const { time, track } = locate(event);
    if (!drag) {
      const hovered = track?.clips.find((c) => time >= c.start && time <= clipEnd(c));
      const edge =
        hovered &&
        (Math.abs((time - hovered.start) * pps) < EDGE ||
          Math.abs((clipEnd(hovered) - time) * pps) < EDGE);
      canvas!.style.cursor = edge ? 'ew-resize' : hovered ? 'grab' : 'text';
      return;
    }
    if (drag.kind === 'move') onMove(drag.clip.id, time - drag.grab, track?.id ?? drag.trackId);
    else if (drag.kind === 'trim') onTrim(drag.clip.id, drag.edge, time);
    else if (Math.abs(time - drag.from) * pps > 3)
      onSelect({
        from: Math.min(drag.from, time),
        to: Math.max(drag.from, time),
        trackId: drag.trackId,
      });
  }

  function up() {
    drag = null;
  }

  // Keep the playhead in view while playing.
  $effect(() => {
    const px = position * pps;
    if (scroller && (px < scroller.scrollLeft || px > scroller.scrollLeft + view.width - 40))
      scroller.scrollLeft = Math.max(0, px - 40);
  });
</script>

<div
  bind:this={scroller}
  class="relative overflow-x-auto overflow-y-hidden rounded-2xl border border-line bg-surface"
  onscroll={() => (view = { ...view, scroll: scroller.scrollLeft })}
>
  <div
    style:width="{duration * pps}px"
    style:height="{height}px"
    role="application"
    aria-label="Timeline. Click to move the playhead, drag across to select, drag a clip to move it, drag its edges to trim."
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
  >
    <canvas
      bind:this={canvas}
      class="sticky top-0 left-0 block touch-none"
      style:width="{view.width}px"
      style:height="{height}px"
    ></canvas>
  </div>
</div>
