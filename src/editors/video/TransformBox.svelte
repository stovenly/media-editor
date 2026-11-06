<script lang="ts">
  import type { Rect } from '../../project/image-edit';

  // Corners scale around the opposite corner; `factor` is relative to the previous onChange's rect.
  // Edges change the bounds without scaling.
  let {
    rect,
    label,
    onChange,
  }: {
    rect: Rect;
    label: string;
    onChange: (rect: Rect, action: 'Move' | 'Scale' | 'Resize', factor: number) => void;
  } = $props();

  type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
  const MIN = 0.03; // smallest side, as a fraction of the frame
  const KEEP = 0.05; // how much must stay inside the frame when moving

  let frame: HTMLDivElement;
  let drag: { handle: Handle; start: Rect; x: number; y: number } | null = null;
  // The box follows the pointer from local state; the project catches up at most once a frame.
  let live = $state<Rect | null>(null);
  const shown = $derived(live ?? rect);
  let pending: { rect: Rect; action: 'Move' | 'Scale' | 'Resize' } | null = null;
  let committed: Rect = { x: 0, y: 0, width: 1, height: 1 };
  let frameId = 0;

  function emit(next: Rect, action: 'Move' | 'Scale' | 'Resize') {
    live = next;
    pending = { rect: next, action };
    if (!frameId) frameId = requestAnimationFrame(flush);
  }

  function flush() {
    frameId = 0;
    if (!pending) return;
    const factor = pending.action === 'Scale' ? pending.rect.width / committed.width : 1;
    committed = pending.rect;
    onChange(pending.rect, pending.action, factor);
    pending = null;
  }

  function down(event: PointerEvent, handle: Handle) {
    event.preventDefault();
    event.stopPropagation();
    frame.setPointerCapture(event.pointerId);
    drag = { handle, start: rect, x: event.clientX, y: event.clientY };
    committed = rect;
  }

  function move(event: PointerEvent) {
    if (!drag) return;
    const bounds = frame.getBoundingClientRect();
    const dx = (event.clientX - drag.x) / bounds.width;
    const dy = (event.clientY - drag.y) / bounds.height;
    const s = drag.start;
    const h = drag.handle;
    if (h === 'move') {
      const x = Math.min(1 - KEEP, Math.max(KEEP - s.width, s.x + dx));
      const y = Math.min(1 - KEEP, Math.max(KEEP - s.height, s.y + dy));
      emit({ ...s, x, y }, 'Move');
      return;
    }
    const west = h.includes('w');
    const north = h.includes('n');
    if (h.length === 2) {
      // Projects the pointer's travel onto the box diagonal, in screen pixels.
      const vx = s.width * bounds.width * (west ? -1 : 1);
      const vy = s.height * bounds.height * (north ? -1 : 1);
      const along = (dx * bounds.width * vx + dy * bounds.height * vy) / (vx * vx + vy * vy);
      const factor = Math.max(MIN / Math.min(s.width, s.height), 1 + along);
      const width = s.width * factor;
      const height = s.height * factor;
      const x = west ? s.x + s.width - width : s.x;
      const y = north ? s.y + s.height - height : s.y;
      emit({ x, y, width, height }, 'Scale');
      return;
    }
    let { x, y, width, height } = s;
    if (h === 'e') width = Math.max(MIN, s.width + dx);
    if (h === 'w') {
      width = Math.max(MIN, s.width - dx);
      x = s.x + s.width - width;
    }
    if (h === 's') height = Math.max(MIN, s.height + dy);
    if (h === 'n') {
      height = Math.max(MIN, s.height - dy);
      y = s.y + s.height - height;
    }
    emit({ x, y, width, height }, 'Resize');
  }

  function up() {
    cancelAnimationFrame(frameId);
    flush();
    drag = null;
    live = null;
  }

  const pct = (value: number) => `${value * 100}%`;
  const HANDLES: { handle: Handle; place: string; cursor: string }[] = [
    { handle: 'nw', place: '-top-1.5 -left-1.5', cursor: 'cursor-nwse-resize' },
    { handle: 'n', place: '-top-1.5 left-1/2 -translate-x-1/2', cursor: 'cursor-ns-resize' },
    { handle: 'ne', place: '-top-1.5 -right-1.5', cursor: 'cursor-nesw-resize' },
    { handle: 'e', place: 'top-1/2 -right-1.5 -translate-y-1/2', cursor: 'cursor-ew-resize' },
    { handle: 'se', place: '-right-1.5 -bottom-1.5', cursor: 'cursor-nwse-resize' },
    { handle: 's', place: '-bottom-1.5 left-1/2 -translate-x-1/2', cursor: 'cursor-ns-resize' },
    { handle: 'sw', place: '-bottom-1.5 -left-1.5', cursor: 'cursor-nesw-resize' },
    { handle: 'w', place: 'top-1/2 -left-1.5 -translate-y-1/2', cursor: 'cursor-ew-resize' },
  ];
</script>

<div
  bind:this={frame}
  class="pointer-events-none absolute inset-0"
  onpointermove={move}
  onpointerup={up}
  role="presentation"
>
  <div
    class="pointer-events-auto absolute cursor-move border border-accent shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
    style:left={pct(shown.x)}
    style:top={pct(shown.y)}
    style:width={pct(shown.width)}
    style:height={pct(shown.height)}
    role="group"
    aria-label="{label}: drag to move, drag a corner to scale, drag an edge to change its bounds"
    onpointerdown={(e) => down(e, 'move')}
  >
    {#each HANDLES as { handle, place, cursor } (handle)}
      <div
        class="absolute size-3 rounded-[3px] border border-accent bg-white {place} {cursor}"
        role="presentation"
        data-handle={handle}
        onpointerdown={(e) => down(e, handle)}
      ></div>
    {/each}
  </div>
</div>
