<script lang="ts">
  import type { Snippet } from 'svelte';

  let { bitmap, overlay }: { bitmap: ImageBitmap | null; overlay?: Snippet } = $props();

  let container: HTMLDivElement;
  let canvas = $state<HTMLCanvasElement>();
  let box = $state({ width: 0, height: 0 });

  $effect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) box = { width: entry.contentRect.width, height: entry.contentRect.height };
    });
    observer.observe(container);
    return () => observer.disconnect();
  });

  const fitted = $derived.by(() => {
    if (!bitmap || !box.width || !box.height) return null;
    const scale = Math.min(box.width / bitmap.width, box.height / bitmap.height);
    return { width: Math.floor(bitmap.width * scale), height: Math.floor(bitmap.height * scale) };
  });

  $effect(() => {
    if (!bitmap || !canvas) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  });
</script>

<div bind:this={container} class="relative grid min-h-0 min-w-0 flex-1 place-items-center">
  {#if fitted}
    <div
      class="checkerboard relative shadow-lg"
      style:width="{fitted.width}px"
      style:height="{fitted.height}px"
    >
      <canvas bind:this={canvas} class="block size-full"></canvas>
      {#if overlay}{@render overlay()}{/if}
    </div>
  {/if}
</div>
