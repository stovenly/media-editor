<script lang="ts">
  import { Archive, LoaderCircle } from '@lucide/svelte';
  import { formatBytes } from '../app/format';
  import VirtualList from '../app/ui/VirtualList.svelte';
  import { scheduler, zipPool } from '../engine';
  import { editing } from '../editors/editing.svelte';
  import { downloadBlob } from '../io/download';
  import { projects } from '../project/open.svelte';
  import { combine } from './combine.svelte';
  import CombinePanel from './CombinePanel.svelte';
  import DetailsDialog from './DetailsDialog.svelte';
  import DropZone from './DropZone.svelte';
  import EngineDownloads from './EngineDownloads.svelte';
  import { plainError } from './errors';
  import FileCard from './FileCard.svelte';
  import { files, type FileItem } from './files.svelte';
  import OptionsPanel from './OptionsPanel.svelte';
  import OutputBar from './OutputBar.svelte';
  import { subtitleAdder } from './subtitles.svelte';
  import SubtitlePanel from './SubtitlePanel.svelte';

  const add = (picked: File[]) => projects.intake(picked);
  let dropZone = $state<ReturnType<typeof DropZone>>();

  function keydown(event: KeyboardEvent) {
    if (editing.current || !(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === 'o') {
      event.preventDefault();
      dropZone?.pick();
    } else if (event.key === 'Enter' && pending.length) {
      event.preventDefault();
      files.convertAll();
    }
  }
  const count = $derived(files.items.length);
  const ready = $derived(files.items.filter((item) => item.status === 'ready').length);
  const pending = $derived(files.pending());
  const busy = $derived(
    files.items.filter((item) => item.job.status === 'waiting' || item.job.status === 'running')
      .length,
  );
  const outputs = $derived(files.outputs());

  const total = $derived.by(() => {
    let bytes = 0;
    let exact = true;
    let known = 0;
    for (const item of files.items) {
      const key = files.keyOf(item);
      if (!key) continue;
      if (item.job.status === 'done' && item.job.key === key) {
        bytes += item.job.output.blob.size;
        known += 1;
      } else if (item.estimate?.key === key && item.estimate.bytes !== null) {
        bytes += item.estimate.bytes;
        exact &&= item.estimate.exact;
        known += 1;
      }
    }
    return known ? { bytes, exact } : null;
  });

  let details = $state<FileItem | null>(null);
  const detailsItem = $derived(
    details ? (files.items.find((item) => item.id === details!.id) ?? null) : null,
  );

  let zipping = $state(false);
  let zipError = $state<string | null>(null);

  async function downloadAll() {
    zipping = true;
    zipError = null;
    try {
      const entries = outputs.map((output) => ({ name: output.name, bytes: output.blob }));
      const task = scheduler.submit({
        pool: zipPool,
        memory: entries.reduce((sum, entry) => sum + entry.bytes.size, 0) * 2,
        run: (api) => api.zip(entries),
      });
      downloadBlob(await task.result, 'converted.zip');
    } catch (error) {
      zipError = plainError(error);
    } finally {
      zipping = false;
    }
  }
</script>

<svelte:window onkeydown={keydown} />

{#if count === 0}
  <DropZone bind:this={dropZone} onFiles={add} />
{:else}
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <DropZone bind:this={dropZone} onFiles={add} compact />
      <button
        type="button"
        class="rounded-full px-3 py-2 text-sm text-muted transition-colors hover:text-fg"
        onclick={() => files.clear()}
      >
        Clear all
      </button>
    </div>

    {#if ready}
      <OutputBar />
      <OptionsPanel />
      {#if combine.available()}<CombinePanel />{/if}
      {#if subtitleAdder.available()}<SubtitlePanel />{/if}
    {/if}

    <EngineDownloads />

    <p class="text-sm text-muted">{count} {count === 1 ? 'file' : 'files'}</p>

    <VirtualList items={files.items} key={(item: FileItem) => item.id} rowHeight={84}>
      {#snippet row(item: FileItem)}
        <div class="h-[76px]">
          <FileCard {item} onDetails={() => (details = item)} onEdit={() => editing.open(item)} />
        </div>
      {/snippet}
    </VirtualList>

    <div
      class="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-raised px-4 py-3 shadow-lg"
    >
      <span class="flex-1 text-sm text-muted tabular-nums">
        {#if total}{total.exact ? '' : 'About '}{formatBytes(total.bytes)} in total{/if}
      </span>
      {#if zipError}<span class="text-sm text-danger">{zipError}</span>{/if}
      {#if busy}
        <button
          type="button"
          class="rounded-full px-4 py-2 text-sm text-muted hover:text-fg"
          onclick={() => files.cancelAll()}>Cancel all</button
        >
      {/if}
      {#if outputs.length > 1}
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-medium transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          disabled={zipping}
          onclick={downloadAll}
        >
          {#if zipping}<LoaderCircle size={15} class="animate-spin" />{:else}<Archive
              size={15}
            />{/if}
          Download all (ZIP)
        </button>
      {/if}
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 font-medium text-on-accent shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pending.length === 0}
        onclick={() => files.convertAll()}
      >
        {#if busy}<LoaderCircle size={16} class="animate-spin" />{/if}
        Convert{pending.length > 1 ? ` ${pending.length} files` : ''}
      </button>
    </div>
  </div>
{/if}

<DetailsDialog item={detailsItem} onClose={() => (details = null)} />

{#if editing.current}
  {@const { item, restore } = editing.current}
  {@const kind = item.inspection?.sniffed.kind}
  {#key item.id}
    {#if kind === 'audio'}
      {#await import('../editors/audio/AudioEditor.svelte') then { default: Editor }}
        <Editor {item} {restore} onClose={() => editing.close()} />
      {/await}
    {:else if kind === 'video'}
      {#await import('../editors/video/VideoEditor.svelte') then { default: Editor }}
        <Editor {item} {restore} onClose={() => editing.close()} />
      {/await}
    {:else}
      {#await import('../editors/image/ImageEditor.svelte') then { default: Editor }}
        <Editor {item} onClose={() => editing.close()} />
      {/await}
    {/if}
  {/key}
{/if}
