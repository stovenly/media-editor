<script lang="ts">
  import { Minus, Plus } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import type { Rect } from '../../project/image-edit';

  // `zoom` is image pixels per device pixel (1 = 100%); null fits the image to the stage.
  let {
    bitmap,
    scale,
    detail,
    zoom = $bindable(null),
    onDetail,
    overlay,
  }: {
    bitmap: ImageBitmap | null;
    scale: number; // preview pixels per full-resolution pixel
    detail: { bitmap: ImageBitmap; region: Rect; key: string } | null;
    zoom?: number | null;
    onDetail: (region: Rect, width: number, height: number, key: string) => void;
    overlay?: Snippet;
  } = $props();

  let container: HTMLDivElement;
  let canvas = $state<HTMLCanvasElement>();
  let detailCanvas = $state<HTMLCanvasElement>();
  let box = $state({ width: 0, height: 0 });
  let scroll = $state({ left: 0, top: 0 });
  let generation = 0;
  let key = $state('0');
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;

  $effect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) box = { width: entry.contentRect.width, height: entry.contentRect.height };
    });
    observer.observe(container);
    return () => observer.disconnect();
  });

  const full = $derived(
    bitmap ? { width: bitmap.width / scale, height: bitmap.height / scale } : null,
  );
  const fitZoom = $derived(
    full && box.width && box.height
      ? Math.min(box.width / full.width, box.height / full.height) * dpr
      : 1,
  );
  const effective = $derived(zoom ?? fitZoom);
  const shown = $derived(
    full
      ? {
          width: Math.max(1, Math.floor((full.width * effective) / dpr)),
          height: Math.max(1, Math.floor((full.height * effective) / dpr)),
        }
      : null,
  );
  const sharper = $derived(
    Boolean(full && zoom !== null && effective > fitZoom * 1.05 && scale < 1),
  );

  $effect(() => {
    if (!bitmap || !canvas) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    key = String(++generation);
  });

  // The visible part of the image, as a fraction of it, asked for at device resolution.
  $effect(() => {
    if (!sharper || !shown) return;
    const region = {
      x: Math.max(0, scroll.left / shown.width),
      y: Math.max(0, scroll.top / shown.height),
      width: Math.min(1, box.width / shown.width),
      height: Math.min(1, box.height / shown.height),
    };
    const width = Math.ceil(Math.min(box.width, shown.width) * dpr);
    const height = Math.ceil(Math.min(box.height, shown.height) * dpr);
    const current = key;
    const timer = setTimeout(() => onDetail(region, width, height, current), 120);
    return () => clearTimeout(timer);
  });

  const visibleDetail = $derived(sharper && detail?.key === key ? detail : null);
  $effect(() => {
    if (!visibleDetail || !detailCanvas) return;
    detailCanvas.width = visibleDetail.bitmap.width;
    detailCanvas.height = visibleDetail.bitmap.height;
    detailCanvas.getContext('2d')?.drawImage(visibleDetail.bitmap, 0, 0);
  });

  const STEPS = [0.25, 0.5, 1, 2, 4, 8];
  export function zoomBy(direction: 1 | -1) {
    const now = effective;
    const next =
      direction > 0
        ? STEPS.find((s) => s > now * 1.01)
        : [...STEPS].reverse().find((s) => s < now * 0.99);
    if (next === undefined || (direction < 0 && next <= fitZoom)) zoom = null;
    else zoom = next;
  }

  // Keeps the centre of the view in place when the zoom changes.
  let lastShown: { width: number; height: number } | null = null;
  $effect(() => {
    if (!shown) return;
    const previous = lastShown;
    lastShown = shown;
    if (!previous || previous.width === shown.width) return;
    const cx = (container.scrollLeft + box.width / 2) / previous.width;
    const cy = (container.scrollTop + box.height / 2) / previous.height;
    requestAnimationFrame(() => {
      container.scrollLeft = cx * shown.width - box.width / 2;
      container.scrollTop = cy * shown.height - box.height / 2;
    });
  });
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
  <div
    bind:this={container}
    class="flex min-h-0 min-w-0 flex-1 {zoom === null ? 'overflow-hidden' : 'overflow-auto'}"
    onscroll={() => (scroll = { left: container.scrollLeft, top: container.scrollTop })}
  >
    {#if shown}
      <div
        class="checkerboard relative m-auto shrink-0 shadow-lg"
        style:width="{shown.width}px"
        style:height="{shown.height}px"
      >
        <canvas bind:this={canvas} class="block size-full"></canvas>
        {#if visibleDetail}
          <canvas
            bind:this={detailCanvas}
            class="pointer-events-none absolute"
            style:left="{visibleDetail.region.x * 100}%"
            style:top="{visibleDetail.region.y * 100}%"
            style:width="{visibleDetail.region.width * 100}%"
            style:height="{visibleDetail.region.height * 100}%"
          ></canvas>
        {/if}
        {#if overlay}{@render overlay()}{/if}
      </div>
    {/if}
  </div>
  {#if full}
    <div
      class="flex shrink-0 items-center justify-center gap-0.5 self-center rounded-full border border-line bg-raised p-0.5 text-xs"
      role="group"
      aria-label="Zoom"
    >
      <button
        type="button"
        class="icon-button size-7"
        aria-label="Zoom out (-)"
        onclick={() => zoomBy(-1)}><Minus size={14} /></button
      >
      <button
        type="button"
        class="min-w-20 rounded-full px-2 py-1 tabular-nums hover:bg-sunken"
        aria-label={zoom === null ? 'Show at 100% (0)' : 'Fit to the window (0)'}
        title={zoom === null ? 'Show at 100% (0)' : 'Fit to the window (0)'}
        onclick={() => (zoom = zoom === null ? 1 : null)}
        >{zoom === null ? 'Fit · ' : ''}{Math.round(effective * 100)}%</button
      >
      <button
        type="button"
        class="icon-button size-7"
        aria-label="Zoom in (+)"
        onclick={() => zoomBy(1)}><Plus size={14} /></button
      >
    </div>
  {/if}
</div>
