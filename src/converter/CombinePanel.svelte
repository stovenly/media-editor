<script lang="ts">
  import { ChevronRight, Download, Layers, LoaderCircle, X } from '@lucide/svelte';
  import { Collapsible } from 'bits-ui';
  import { formatBytes } from '../app/format';
  import NumberField from '../app/ui/NumberField.svelte';
  import Segmented, { type SegmentedOption } from '../app/ui/Segmented.svelte';
  import Select, { type SelectOption } from '../app/ui/Select.svelte';
  import { hub } from '../engine';
  import { target } from '../engine/targets';
  import { downloadBlob } from '../io/download';
  import { combine, COMBINE_TARGETS, type CombineTarget } from './combine.svelte';

  let open = $state(false);
  const images = $derived(combine.images());
  const audios = $derived(combine.audios());
  const job = $derived(combine.state);
  const progress = $derived(
    job.status === 'running' && job.taskId ? (hub.latest.get(job.taskId) ?? 0) : 0,
  );
  const video = $derived(target(combine.target).group === 'video');
  const coverOnly = $derived(video && images.length === 1 && combine.audioId !== null);

  const SHORT: Record<CombineTarget, string> = {
    mp4: 'MP4',
    webm: 'WebM',
    'gif-anim': 'GIF',
    'webp-anim': 'WebP',
    apng: 'APNG',
  };
  const makeOptions = $derived<SegmentedOption<CombineTarget>[]>(
    COMBINE_TARGETS.filter((id) => images.length > 1 || target(id).group === 'video').map((id) => ({
      value: id,
      label: SHORT[id],
      tooltip: target(id).group === 'video' ? `${target(id).label} video` : target(id).label,
    })),
  );
  // File ids all start with "file-", so this can't collide with one.
  const NO_SOUND = 'none';
  const soundOptions = $derived<SelectOption<string>[]>([
    { value: NO_SOUND, label: 'None' },
    ...audios.map((audio) => ({ value: audio.id, label: audio.file.name })),
  ]);

  const summary = $derived(
    images.length === 1
      ? `Make a video from ${audios.length === 1 ? audios[0]!.file.name : 'audio'} with a picture`
      : `Combine ${images.length} images into an animation or slideshow`,
  );

  $effect(() => {
    if (images.length === 1 && combine.audioId === null && audios[0])
      combine.audioId = audios[0].id;
    if (images.length === 1 && !video) combine.target = 'mp4';
  });
</script>

<Collapsible.Root bind:open>
  <Collapsible.Trigger class="flex w-full items-center gap-2 px-5 py-4 text-left text-sm">
    <ChevronRight size={16} class="text-muted transition-transform {open ? 'rotate-90' : ''}" />
    <Layers size={15} class="text-muted" />
    <span class="font-medium">Combine</span>
    <span class="truncate text-muted">· {summary}</span>
  </Collapsible.Trigger>
  <Collapsible.Content class="grid gap-4 px-5 pb-5 text-sm">
    <Segmented
      label="Make"
      options={makeOptions}
      value={combine.target}
      onChange={(id) => (combine.target = id)}
    />
    {#if !coverOnly}
      <NumberField
        label="Seconds per image"
        value={combine.seconds}
        min={0.05}
        step={0.05}
        unit="s"
        onChange={(seconds) => (combine.seconds = seconds)}
      />
    {/if}
    {#if video && audios.length}
      <Select
        label="Sound"
        options={soundOptions}
        value={combine.audioId ?? NO_SOUND}
        onChange={(id) => (combine.audioId = id === NO_SOUND ? null : id)}
      />
    {/if}
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
        {:else if job.status === 'failed'}
          <span class="text-danger" title={job.detail}>{job.message}</span>
        {:else}
          Images are used in the order they appear below.
        {/if}
      </p>
      {#if job.status === 'running'}
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-muted hover:text-fg"
          onclick={() => combine.cancel()}
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
          onclick={() => void combine.start()}
        >
          Combine
        </button>
      {/if}
    </div>
  </Collapsible.Content>
</Collapsible.Root>
