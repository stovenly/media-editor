<script lang="ts">
  import { RotateCcw } from '@lucide/svelte';

  let { label, onclick }: { label: string; onclick: () => void } = $props();
</script>

<button
  type="button"
  class="inline-flex items-center gap-1 text-xs text-muted hover:text-accent"
  aria-label="Reset {label.toLowerCase()}"
  {onclick}
>
  <RotateCcw size={12} /> Reset
</button>
