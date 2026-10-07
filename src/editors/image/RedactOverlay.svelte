<script lang="ts">
  import { clampRect, type Rect, type Redaction } from '../../project/image-edit';

  let {
    redactions,
    selected,
    onDraw,
    onSelect,
  }: {
    redactions: readonly Redaction[];
    selected: string | null;
    onDraw: (rect: Rect) => void;
    onSelect: (id: string | null) => void;
  } = $props();

  let frame: HTMLDivElement;
  let start: { x: number; y: number } | null = null;
  let draft = $state<Rect | null>(null);

  function point(event: PointerEvent) {
    const bounds = frame.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  }

  function down(event: PointerEvent) {
    frame.setPointerCapture(event.pointerId);
    start = point(event);
    draft = { ...start, width: 0, height: 0 };
    onSelect(null);
  }

  function move(event: PointerEvent) {
    if (!start) return;
    const p = point(event);
    draft = {
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      width: Math.abs(p.x - start.x),
      height: Math.abs(p.y - start.y),
    };
  }

  function up() {
    if (draft && draft.width > 0.005 && draft.height > 0.005) onDraw(clampRect(draft));
    start = null;
    draft = null;
  }

  const pct = (value: number) => `${value * 100}%`;
</script>

<div
  bind:this={frame}
  class="absolute inset-0 cursor-crosshair touch-none"
  role="application"
  aria-label="Drag to draw an area to cover"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
>
  {#each redactions as redaction (redaction.id)}
    <button
      type="button"
      aria-label="Select covered area"
      class="absolute border-2 {redaction.id === selected
        ? 'border-accent'
        : 'border-white/70'} border-dashed"
      style:left={pct(redaction.rect.x)}
      style:top={pct(redaction.rect.y)}
      style:width={pct(redaction.rect.width)}
      style:height={pct(redaction.rect.height)}
      onpointerdown={(e) => {
        e.stopPropagation();
        onSelect(redaction.id);
      }}
    ></button>
  {/each}
  {#if draft}
    <div
      class="absolute border-2 border-accent bg-accent/20"
      style:left={pct(draft.x)}
      style:top={pct(draft.y)}
      style:width={pct(draft.width)}
      style:height={pct(draft.height)}
    ></div>
  {/if}
</div>
