<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';

  type Props = {
    items: readonly T[];
    key: (item: T) => string;
    rowHeight: number; // px, including the gap below each row
    overscan?: number;
    row: Snippet<[T]>;
  };

  let { items, key, rowHeight, overscan = 6, row }: Props = $props();

  let container: HTMLElement | undefined = $state();
  let scrollY = $state(0);
  let innerHeight = $state(0);
  let top = $state(0);

  $effect(() => {
    if (!container) return;
    const measure = () => (top = container!.getBoundingClientRect().top + window.scrollY);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => observer.disconnect();
  });

  const first = $derived(Math.max(0, Math.floor((scrollY - top) / rowHeight) - overscan));
  const last = $derived(
    Math.min(items.length, Math.ceil((scrollY - top + innerHeight) / rowHeight) + overscan),
  );
  const visible = $derived(items.slice(first, last));
</script>

<svelte:window bind:scrollY bind:innerHeight />

<div bind:this={container} class="relative" style:height="{items.length * rowHeight}px">
  {#each visible as item, i (key(item))}
    <div
      class="absolute inset-x-0"
      style:top="{(first + i) * rowHeight}px"
      style:height="{rowHeight}px"
    >
      {@render row(item)}
    </div>
  {/each}
</div>
