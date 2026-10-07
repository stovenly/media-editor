<script lang="ts">
  import { X } from '@lucide/svelte';
  import { Dialog } from 'bits-ui';
  import { formatBytes } from '../app/format';
  import { files, type FileItem } from './files.svelte';

  let { item, onClose }: { item: FileItem | null; onClose: () => void } = $props();

  const groups = $derived.by(() => {
    const byGroup = new Map<string, { name: string; value: string }[]>();
    for (const field of item?.inspection?.metadata?.fields ?? []) {
      byGroup.set(field.group, [...(byGroup.get(field.group) ?? []), field]);
    }
    return [...byGroup];
  });

  const metadataLine = $derived.by(() => {
    const mode = files.options.metadata;
    if (mode === 'all') return 'All metadata will be kept.';
    if (mode === 'technical')
      return 'Only the colour profile will be kept. Everything below will be removed.';
    return 'Everything below will be removed from the converted file.';
  });
</script>

<Dialog.Root open={item !== null} onOpenChange={(open) => !open && onClose()}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-40 bg-black/40" />
    <Dialog.Content
      class="fixed top-1/2 left-1/2 z-50 flex max-h-[85dvh] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-3xl border border-line bg-raised shadow-2xl outline-none"
    >
      {#if item}
        <div class="flex items-start gap-3 border-b border-line px-5 py-4">
          <div class="min-w-0 flex-1">
            <Dialog.Title class="truncate font-semibold">{item.file.name}</Dialog.Title>
            <Dialog.Description class="text-sm text-muted">
              {item.inspection?.sniffed.label} · {formatBytes(item.file.size)}
            </Dialog.Description>
          </div>
          <Dialog.Close class="icon-button" aria-label="Close"><X size={16} /></Dialog.Close>
        </div>
        <div class="space-y-5 overflow-y-auto px-5 py-4 text-sm">
          {#if item.job.status === 'done'}
            <section class="space-y-1">
              <h3 class="font-medium">Result</h3>
              <p class="text-muted">
                {item.job.output.name} · {formatBytes(item.job.output.blob.size)}
                {#if item.job.output.width}· {item.job.output.width}×{item.job.output.height}{/if}
                {#if item.job.output.quality}· quality {item.job.output.quality}{/if}
              </p>
              {#each item.job.output.notes as note (note)}<p class="text-muted">{note}</p>{/each}
            </section>
          {/if}
          {#if item.job.status === 'failed'}
            <section class="space-y-1">
              <h3 class="font-medium">What went wrong</h3>
              <p class="text-danger">{item.job.message}</p>
              {#if item.job.detail !== item.job.message}<p
                  class="font-mono text-xs break-words text-muted"
                >
                  {item.job.detail}
                </p>{/if}
            </section>
          {/if}
          {#if item.inspection?.metadata?.provenance}
            <p class="rounded-xl bg-sunken px-3 py-2 text-muted">
              This file has Content Credentials (C2PA). Removing metadata removes them too.
            </p>
          {/if}
          <section class="space-y-2">
            <h3 class="font-medium">Metadata</h3>
            {#if groups.length}
              <p class="text-muted">{metadataLine}</p>
              {#each groups as [group, fields] (group)}
                <div>
                  <h4 class="pt-2 pb-1 text-xs font-medium tracking-wide text-muted uppercase">
                    {group}
                  </h4>
                  <dl class="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1">
                    {#each fields as field, index (index)}
                      <dt class="text-muted">{field.name}</dt>
                      <dd class="break-words">{field.value}</dd>
                    {/each}
                  </dl>
                </div>
              {/each}
            {:else}
              <p class="text-muted">No metadata found.</p>
            {/if}
          </section>
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
