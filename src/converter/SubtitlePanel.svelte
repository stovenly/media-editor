<script lang="ts">
  import { Captions, ChevronRight, Download, LoaderCircle, X } from '@lucide/svelte';
  import { Collapsible } from 'bits-ui';
  import { formatBytes } from '../app/format';
  import Select from '../app/ui/Select.svelte';
  import { hub } from '../engine';
  import { downloadBlob } from '../io/download';
  import { subtitleAdder as adder } from './subtitles.svelte';

  let open = $state(false);
  const videos = $derived(adder.videos());
  const subtitles = $derived(adder.subtitleFiles());
  const job = $derived(adder.state);
  const progress = $derived(
    job.status === 'running' && job.taskId ? (hub.latest.get(job.taskId) ?? 0) : 0,
  );
</script>

<Collapsible.Root bind:open>
  <Collapsible.Trigger class="flex w-full items-center gap-2 px-5 py-4 text-left text-sm">
    <ChevronRight size={16} class="text-muted transition-transform {open ? 'rotate-90' : ''}" />
    <Captions size={15} class="text-muted" />
    <span class="font-medium">Add subtitles</span>
    <span class="truncate text-muted">· as a track viewers can turn on, without re-encoding</span>
  </Collapsible.Trigger>
  <Collapsible.Content class="grid gap-4 px-5 pb-5 text-sm">
    <Select
      label="Video"
      options={videos.map((v) => ({ value: v.id, label: v.file.name }))}
      value={adder.videoId ?? videos[0]?.id ?? ''}
      onChange={(id) => (adder.videoId = id)}
    />
    <Select
      label="Subtitles"
      options={subtitles.map((f) => ({ value: f.id, label: f.file.name }))}
      value={adder.subtitleId ?? subtitles[0]?.id ?? ''}
      onChange={(id) => (adder.subtitleId = id)}
    />
    <label class="grid gap-1">
      <span class="text-xs text-muted">Language (optional)</span>
      <input
        class="h-8 rounded-lg border border-line bg-surface px-2 text-sm"
        maxlength="3"
        placeholder="eng"
        aria-describedby="subtitle-language-hint"
        bind:value={adder.language}
      />
      <span id="subtitle-language-hint" class="text-xs text-muted"
        >Three-letter code, such as eng, fra or deu</span
      >
    </label>
    <div class="flex flex-wrap items-center gap-3">
      <p class="flex-1 text-muted">
        {#if job.status === 'running'}
          <span class="inline-flex items-center gap-1.5"
            ><LoaderCircle size={14} class="animate-spin" /> Working · {Math.round(
              progress * 100,
            )}%</span
          >
        {:else if job.status === 'done'}
          {job.output.name} · {formatBytes(job.output.blob.size)}
          {#each job.output.notes as note (note)}<span class="block text-xs">{note}</span>{/each}
        {:else if job.status === 'failed'}
          <span class="text-danger" title={job.detail}>{job.message}</span>
        {:else}
          MP4 and MOV get a mov_text track, WebM a WebVTT track, and other videos become MKV.
        {/if}
      </p>
      {#if job.status === 'running'}
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-muted hover:text-fg"
          onclick={() => adder.cancel()}
        >
          <X size={14} /> Cancel
        </button>
      {:else}
        {#if job.status === 'done'}
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-4 py-2 font-medium text-accent hover:bg-accent hover:text-on-accent"
            aria-label="Download {job.output.name}"
            onclick={() => job.status === 'done' && downloadBlob(job.output.blob, job.output.name)}
          >
            <Download size={15} /> Download
          </button>
        {/if}
        <button
          type="button"
          class="rounded-full bg-accent px-5 py-2 font-medium text-on-accent shadow-sm hover:bg-accent-hover"
          onclick={() => void adder.start()}
        >
          Add subtitles
        </button>
      {/if}
    </div>
  </Collapsible.Content>
</Collapsible.Root>
