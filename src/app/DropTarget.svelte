<script lang="ts">
  import { Upload } from '@lucide/svelte';
  import { fade } from 'svelte/transition';
  import { filesFromDrop, filesFromPaste } from '../io/intake';

  let { onFiles }: { onFiles: (files: File[]) => void } = $props();

  let depth = $state(0);
  const dragging = $derived(depth > 0);

  const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

  function enter(event: DragEvent) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth += 1;
  }

  function over(event: DragEvent) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
  }

  function leave(event: DragEvent) {
    if (!carriesFiles(event)) return;
    depth = Math.max(0, depth - 1);
  }

  function drop(event: DragEvent) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth = 0;
    void filesFromDrop(event.dataTransfer!).then(onFiles);
  }

  function paste(event: ClipboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, [contenteditable]')) return;
    const pasted = filesFromPaste(event);
    if (pasted.length === 0) return;
    event.preventDefault();
    onFiles(pasted);
  }
</script>

<svelte:window
  ondragenter={enter}
  ondragover={over}
  ondragleave={leave}
  ondrop={drop}
  onpaste={paste}
/>

{#if dragging}
  <div
    class="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-surface/80 p-6 backdrop-blur-sm"
    transition:fade={{ duration: 120 }}
  >
    <div
      class="flex h-full w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-accent text-accent"
    >
      <Upload size={40} strokeWidth={1.5} />
      <p class="text-lg font-medium">Drop to add files</p>
    </div>
  </div>
{/if}
