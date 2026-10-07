<script lang="ts">
  import { LoaderCircle } from '@lucide/svelte';
  import { formatBytes } from '../app/format';
  import { downloads, ENGINE_LABELS } from '../engine/downloads.svelte';
</script>

{#each downloads.active as download (download.engine)}
  <div
    class="flex items-center gap-3 rounded-2xl border border-line bg-raised px-4 py-3 text-sm shadow-xs"
    role="status"
  >
    <LoaderCircle size={16} class="animate-spin text-accent" />
    <span class="flex-1">
      Downloading the {ENGINE_LABELS[download.engine]} (once only)
      <span class="text-muted tabular-nums"
        >· {formatBytes(download.loaded)} of {formatBytes(download.total)}</span
      >
    </span>
    <div class="h-1.5 w-24 overflow-hidden rounded-full bg-sunken">
      <div class="h-full bg-accent" style:width="{(download.loaded / download.total) * 100}%"></div>
    </div>
  </div>
{/each}
