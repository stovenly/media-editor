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
  import { wakeLock } from './wake-lock.svelte';
  import SubtitlePanel from './SubtitlePanel.svelte';

  const add = (picked: File[]) => projects.intake(picked);

  const KIND_NAMES = {
    image: ['image', 'images'],
    video: ['video', 'videos'],
    audio: ['audio file', 'audio files'],
    subtitle: ['subtitle file', 'subtitle files'],
  } as const;
  const current = $derived(files.selectedItem());
  const failure = $derived.by(() => {
    const job = current?.job;
    return job?.status === 'failed' && job.key === files.keyOf(current!) ? job : null;
  });
  const sameKind = $derived.by(() => {
    const kind = current?.inspection?.sniffed.kind;
    return kind
      ? files.items.filter(
          (item) =>
            item.id !== current!.id &&
            item.status === 'ready' &&
            item.inspection?.sniffed.kind === kind,
        ).length
      : 0;
  });
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

{#if count === 0}
  <div class="grid flex-1 place-items-center py-8">
    <div class="w-full max-w-2xl">
      <DropZone onFiles={add} />
    </div>
  </div>
{:else}
  <div class="flex flex-1 items-start gap-6 pt-6 pb-20">
    <section class="min-w-0 flex-1 space-y-3">
      <div class="flex items-center gap-3">
        <DropZone onFiles={add} compact />
        <span class="ml-auto text-sm text-muted">{count} {count === 1 ? 'file' : 'files'}</span>
        <button
          type="button"
          class="rounded-full px-3 py-2 text-sm text-muted transition-colors hover:text-fg"
          onclick={() => files.clear()}
        >
          Clear all
        </button>
      </div>

      <EngineDownloads />

      <div class="overflow-hidden rounded-xl border border-line bg-raised">
        <VirtualList items={files.items} key={(item: FileItem) => item.id} rowHeight={64}>
          {#snippet row(item: FileItem)}
            <FileCard
              {item}
              selected={item.id === files.selected}
              onSelect={() => files.select(item.id)}
              onDetails={() => (details = item)}
              onEdit={() => editing.open(item)}
            />
          {/snippet}
        </VirtualList>
      </div>
    </section>

    <aside
      class="sticky top-[4.5rem] flex max-h-[calc(100dvh-9rem)] w-[30rem] shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-raised"
      aria-label="Conversion settings"
    >
      <div class="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        {#if current}
          <div class="px-5 pt-5 pb-4">
            <p class="text-xs text-muted">Settings for</p>
            <p class="truncate font-semibold" title={current.file.name}>{current.file.name}</p>
          </div>
          {#if current.status === 'ready' && current.inspection?.sniffed.kind}
            {#key current.id}
              <OutputBar item={current} />
              {#if files.targetOf(current)}<OptionsPanel item={current} />{/if}
            {/key}
            {#if sameKind > 0}
              <div class="p-5">
                <button
                  type="button"
                  class="w-full rounded-full border border-line px-4 py-2 text-sm font-medium transition-colors hover:border-accent hover:text-accent"
                  onclick={() => files.applyToKind()}
                  >Use these settings for the other {sameKind === 1
                    ? KIND_NAMES[current.inspection.sniffed.kind][0]
                    : `${sameKind} ${KIND_NAMES[current.inspection.sniffed.kind][1]}`}</button
                >
              </div>
            {/if}
          {:else if current.status === 'inspecting'}
            <p class="inline-flex items-center gap-2 p-5 text-sm text-muted">
              <LoaderCircle size={14} class="animate-spin" /> Checking this file…
            </p>
          {:else}
            <p class="p-5 text-sm text-muted">This file can't be converted.</p>
          {/if}
        {/if}
        {#if ready && combine.available()}<CombinePanel />{/if}
        {#if ready && subtitleAdder.available()}<SubtitlePanel />{/if}
      </div>

      <div class="space-y-3 border-t border-line p-4">
        {#if total || wakeLock.busy}
          <p class="text-sm text-muted tabular-nums">
            {#if total}{total.exact ? '' : 'About '}{formatBytes(total.bytes)} in total{/if}
            {#if wakeLock.busy}<span class="block text-xs" role="status"
                >Keep this tab open until your files are ready.{wakeLock.frozeDuringWork
                  ? ' The browser paused it in the background, which slowed things down.'
                  : ''}</span
              >{/if}
          </p>
        {/if}
        {#if failure}<p class="text-sm text-danger" role="alert" title={failure.detail}>
            {failure.message}
          </p>{/if}
        {#if zipError}<p class="text-sm text-danger">{zipError}</p>{/if}
        {#if busy || outputs.length > 1}
          <div class="flex items-center gap-2">
            {#if outputs.length > 1}
              <button
                type="button"
                class="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-medium transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                disabled={zipping}
                onclick={downloadAll}
              >
                {#if zipping}<LoaderCircle size={15} class="animate-spin" />{:else}<Archive
                    size={15}
                  />{/if}
                Download all (ZIP)
              </button>
            {/if}
            {#if busy}
              <button
                type="button"
                class="rounded-full px-4 py-2 text-sm text-muted hover:text-fg"
                onclick={() => files.cancelAll()}>Cancel all</button
              >
            {/if}
          </div>
        {/if}
        <label class="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            class="accent-accent"
            checked={files.autoDownload}
            onchange={(e) => files.setAutoDownload(e.currentTarget.checked)}
          />
          Download each file when it's done
        </label>
        <button
          type="button"
          class="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-5 py-2.5 font-medium text-on-accent shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          disabled={pending.length === 0}
          onclick={() => files.convertAll()}
        >
          {#if busy}<LoaderCircle size={16} class="animate-spin" />{/if}
          Convert{pending.length > 1 ? ` ${pending.length} files` : ''}
        </button>
      </div>
    </aside>
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
