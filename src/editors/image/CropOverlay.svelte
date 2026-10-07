<script lang="ts">
  import { clampRect, type Rect } from '../../project/image-edit';

  // aspect is width / height in fractions of this image, so it already accounts for the image's own shape.
  let {
    rect,
    aspect,
    onChange,
  }: { rect: Rect; aspect: number | null; onChange: (rect: Rect, label: string) => void } =
    $props();

  type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';
  let frame: HTMLDivElement;
  let drag: { handle: Handle; start: Rect; x: number; y: number } | null = null;

  function down(event: PointerEvent, handle: Handle) {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = { handle, start: rect, x: event.clientX, y: event.clientY };
  }

  function move(event: PointerEvent) {
    if (!drag) return;
    const bounds = frame.getBoundingClientRect();
    const dx = (event.clientX - drag.x) / bounds.width;
    const dy = (event.clientY - drag.y) / bounds.height;
    const s = drag.start;
    let next: Rect;
    if (drag.handle === 'move') {
      next = {
        ...s,
        x: Math.min(1 - s.width, Math.max(0, s.x + dx)),
        y: Math.min(1 - s.height, Math.max(0, s.y + dy)),
      };
    } else {
      const left = drag.handle === 'nw' || drag.handle === 'sw';
      const top = drag.handle === 'nw' || drag.handle === 'ne';
      let x1 = left ? s.x + dx : s.x;
      let y1 = top ? s.y + dy : s.y;
      let x2 = left ? s.x + s.width : s.x + s.width + dx;
      let y2 = top ? s.y + s.height : s.y + s.height + dy;
      x1 = Math.max(0, Math.min(x1, x2 - 0.02));
      y1 = Math.max(0, Math.min(y1, y2 - 0.02));
      x2 = Math.min(1, Math.max(x2, x1 + 0.02));
      y2 = Math.min(1, Math.max(y2, y1 + 0.02));
      if (aspect) {
        const width = x2 - x1;
        const height = width / aspect;
        if (top) y1 = y2 - height;
        else y2 = y1 + height;
        if (y1 < 0 || y2 > 1) {
          const fit = top ? y2 : 1 - y1;
          const h = Math.min(height, fit);
          if (top) y1 = y2 - h;
          else y2 = y1 + h;
          const w = h * aspect;
          if (left) x1 = x2 - w;
          else x2 = x1 + w;
        }
      }
      next = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
    }
    onChange(clampRect(next), 'Crop');
  }

  function up() {
    drag = null;
  }

  function key(event: KeyboardEvent) {
    const step = event.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    onChange(
      clampRect({
        ...rect,
        x: Math.min(1 - rect.width, Math.max(0, rect.x + delta[0])),
        y: Math.min(1 - rect.height, Math.max(0, rect.y + delta[1])),
      }),
      'Crop',
    );
  }

  const pct = (value: number) => `${value * 100}%`;
  const GRID = [0, 1, 2, 3, 4, 5, 6, 7, 8];
</script>

<div
  bind:this={frame}
  class="absolute inset-0"
  onpointermove={move}
  onpointerup={up}
  role="presentation"
>
  <div
    class="pointer-events-none absolute inset-0 bg-black/50"
    style:clip-path="polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, {pct(rect.x)}
    {pct(rect.y)}, {pct(rect.x)}
    {pct(rect.y + rect.height)}, {pct(rect.x + rect.width)}
    {pct(rect.y + rect.height)}, {pct(rect.x + rect.width)}
    {pct(rect.y)}, {pct(rect.x)}
    {pct(rect.y)})"
  ></div>
  <div
    class="absolute cursor-move border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)] outline-none focus-visible:border-accent"
    style:left={pct(rect.x)}
    style:top={pct(rect.y)}
    style:width={pct(rect.width)}
    style:height={pct(rect.height)}
    role="slider"
    tabindex="0"
    aria-label="Crop area. Use the arrow keys to move it."
    aria-valuenow={Math.round(rect.x * 100)}
    onpointerdown={(e) => down(e, 'move')}
    onkeydown={key}
  >
    <div class="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
      {#each GRID as cell (cell)}<div class="border border-white/25"></div>{/each}
    </div>
    {#each ['nw', 'ne', 'sw', 'se'] as const as handle (handle)}
      <div
        class="absolute size-4 rounded-sm border-2 border-white bg-accent {handle === 'nw'
          ? '-top-2 -left-2 cursor-nwse-resize'
          : handle === 'ne'
            ? '-top-2 -right-2 cursor-nesw-resize'
            : handle === 'sw'
              ? '-bottom-2 -left-2 cursor-nesw-resize'
              : '-right-2 -bottom-2 cursor-nwse-resize'}"
        role="presentation"
        onpointerdown={(e) => down(e, handle)}
      ></div>
    {/each}
  </div>
</div>
