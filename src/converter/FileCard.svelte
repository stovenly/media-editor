<script lang="ts">
  import {
    CircleAlert,
    Download,
    File as FileIcon,
    Film,
    Image,
    Info,
    LoaderCircle,
    Music,
    Pencil,
    RotateCcw,
    Share,
    X,
  } from '@lucide/svelte';
  import { formatBytes, formatDuration } from '../app/format';
  import { hub, platform } from '../engine';
  import { routeAv } from '../engine/av/plan';
  import { outputWarnLimit } from '../engine/scheduler/budget';
  import { avSettings } from './run';
  import { target } from '../engine/targets';
  import { canShare, downloadBlob, shareFiles } from '../io/download';
  import { factsOf, files, type FileItem } from './files.svelte';
  import TargetMenu from './TargetMenu.svelte';

  let { item, onDetails, onEdit }: { item: FileItem; onDetails: () => void; onEdit: () => void } =
    $props();

  const icons = { image: Image, audio: Music, video: Film };
  const kind = $derived(item.inspection?.sniffed.kind ?? null);
  const Icon = $derived(kind ? icons[kind] : FileIcon);
  const targetId = $derived(files.targetOf(item));
  const key = $derived(files.keyOf(item));
  const out = $derived(targetId ? target(targetId) : null);
  const job = $derived(item.job);
  const current = $derived(job.status !== 'idle' && job.key === key);

  let thumbUrl = $state<string | null>(null);
  $effect(() => {
    const blob = item.inspection?.thumbnail;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    thumbUrl = url;
    return () => URL.revokeObjectURL(url);
  });

  // Image engines give no usable progress, so those jobs show an indeterminate bar rather than invented numbers.
  const measured = $derived(kind !== 'image' && out?.group !== 'image' && out?.group !== 'icon');
  const progress = $derived(job.status === 'running' ? (hub.latest.get(job.taskId) ?? 0) : 0);
  let now = $state(performance.now());
  $effect(() => {
    if (job.status !== 'running') return;
    const timer = setInterval(() => (now = performance.now()), 1000);
    return () => clearInterval(timer);
  });
  const remaining = $derived.by(() => {
    if (job.status !== 'running' || progress < 0.05) return null;
    const elapsed = (now - job.started) / 1000;
    return Math.max(0, (elapsed * (1 - progress)) / progress);
  });

  const description = $derived.by(() => {
    const i = item.inspection;
    if (!i) return '';
    const parts = [i.sniffed.label];
    if (i.width && i.height) parts.push(`${i.width}×${i.height}`);
    if (i.pages > 1) parts.push(`${i.pages} frames`);
    if (i.duration) parts.push(formatDuration(i.duration));
    parts.push(formatBytes(item.file.size));
    return parts.join(' · ');
  });

  const warnings = $derived.by(() => {
    const i = item.inspection;
    if (!i || !out) return [];
    const list: string[] = [];
    if ((i.metadata?.location || i.av?.tags.location) && files.options.metadata !== 'all')
      list.push('Location data found · will be removed');
    const bytes = item.estimate?.bytes;
    if (bytes && targetId) {
      const engine = i.av ? routeAv(i.av, avSettings(targetId, files.options)) : 'native';
      if (bytes > outputWarnLimit(platform, engine))
        list.push('This may be too large for your browser');
    }
    if (i.alpha && !out.alpha) list.push('Transparency will be filled');
    if (i.pages > 1 && out.group !== 'animated' && out.group !== 'video')
      list.push('Only the first frame will be kept');
    if (i.metadata?.hdr && targetId !== 'jpeg') list.push('HDR will be dropped');
    return list;
  });

  const notes = $derived(job.status === 'done' && current ? job.output.notes : []);
  const shareable = $derived(
    job.status === 'done'
      ? canShare([new File([job.output.blob], job.output.name, { type: job.output.blob.type })])
      : false,
  );

  function share() {
    if (job.status !== 'done') return;
    void shareFiles([new File([job.output.blob], job.output.name, { type: job.output.blob.type })]);
  }
</script>

<article
  class="relative flex h-full items-center gap-3 overflow-hidden rounded-2xl border border-line bg-raised px-3 shadow-xs sm:gap-4 sm:px-4"
>
  <div
    class="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl {thumbUrl
      ? 'checkerboard'
      : item.status === 'ready'
        ? 'bg-accent-soft text-accent'
        : 'bg-sunken text-muted'}"
  >
    {#if thumbUrl}
      <img src={thumbUrl} alt="" class="size-full object-contain" />
    {:else}
      <Icon size={20} />
    {/if}
  </div>

  <div class="min-w-0 flex-1">
    <div class="flex items-center gap-2">
      <p class="min-w-0 truncate font-medium" title={item.file.name}>{item.file.name}</p>
      {#if kind && item.status === 'ready'}
        <TargetMenu
          {kind}
          facts={factsOf(item.inspection)}
          value={targetId}
          label="Output format for {item.file.name}"
          onPick={(id) => files.setTarget(item.id, id)}
        >
          {#snippet trigger()}<span class="text-xs">{out ? `→ ${out.label}` : 'Choose format'}</span
            >{/snippet}
        </TargetMenu>
      {/if}
    </div>
    <p class="truncate text-sm text-muted">
      {#if item.status === 'inspecting'}
        <span class="inline-flex items-center gap-1.5"
          ><LoaderCircle size={13} class="animate-spin" /> Checking file…</span
        >
      {:else if item.status === 'unsupported'}
        <span class="inline-flex items-center gap-1.5 text-warning"
          ><CircleAlert size={13} /> Can't convert this file · {item.inspection?.sniffed
            .label}</span
        >
      {:else if item.status === 'error'}
        <span class="inline-flex items-center gap-1.5 text-danger"
          ><CircleAlert size={13} /> Couldn't read this file · {item.error}</span
        >
      {:else if job.status === 'failed' && current}
        <span class="text-danger" title={job.detail}>{job.message}</span>
      {:else if job.status === 'done' && current}
        {@const done = [
          ...notes,
          ...((item.inspection?.metadata?.location || item.inspection?.av?.tags.location) &&
          files.options.metadata !== 'all'
            ? ['Location data removed']
            : []),
        ]}
        <span title={done.join(' · ')}>{done.length ? done.join(' · ') : description}</span>
      {:else}
        {description}{#each warnings as warning (warning)}<span class="text-warning">
            · {warning}</span
          >{/each}
      {/if}
    </p>
  </div>

  <div class="flex shrink-0 items-center gap-1 text-sm">
    {#if job.status === 'waiting' && current}
      <span class="inline-flex items-center gap-1.5 text-muted"
        ><LoaderCircle size={14} class="animate-spin" /> Waiting</span
      >
      <button
        type="button"
        class="icon-button"
        aria-label="Cancel {item.file.name}"
        onclick={() => files.cancel(item.id)}><X size={16} /></button
      >
    {:else if job.status === 'running' && current}
      <span class="tabular-nums text-muted">
        {#if measured}
          {Math.round(progress * 100)}%{#if remaining !== null && remaining > 2}<span
              class="hidden sm:inline"
            >
              · {formatDuration(remaining)} left</span
            >{/if}
        {:else}
          Converting…
        {/if}
      </span>
      <button
        type="button"
        class="icon-button"
        aria-label="Cancel {item.file.name}"
        onclick={() => files.cancel(item.id)}><X size={16} /></button
      >
    {:else if job.status === 'done' && current}
      <span class="tabular-nums text-muted">{formatBytes(job.output.blob.size)}</span>
      {#if shareable}
        <button
          type="button"
          class="icon-button"
          aria-label="Share {job.output.name}"
          onclick={share}><Share size={16} /></button
        >
      {/if}
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 font-medium text-accent transition-colors hover:bg-accent hover:text-on-accent"
        aria-label="Download {job.output.name}"
        onclick={() => job.status === 'done' && downloadBlob(job.output.blob, job.output.name)}
      >
        <Download size={15} /> <span class="hidden sm:inline">Download</span>
      </button>
    {:else if job.status === 'failed' && current}
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-muted hover:text-fg"
        onclick={() => files.convert(item.id)}
      >
        <RotateCcw size={14} /> Retry
      </button>
    {:else if item.estimate && item.estimate.key === key}
      <span class="tabular-nums text-muted" title="Estimated size">
        {#if item.estimate.bytes === null}<LoaderCircle
            size={14}
            class="animate-spin"
          />{:else}{item.estimate.exact ? '' : '~'}{formatBytes(item.estimate.bytes)}{/if}
      </span>
    {/if}
    {#if item.status === 'ready' && ((kind === 'image' && (item.inspection?.pages ?? 1) <= 1) || kind === 'audio' || kind === 'video')}
      <button
        type="button"
        class="icon-button {item.edit ? 'text-accent' : ''}"
        aria-label="Edit {item.file.name}"
        title={item.edit ? 'Edited' : 'Edit'}
        onclick={onEdit}><Pencil size={16} /></button
      >
    {/if}
    {#if item.status === 'ready'}
      <button
        type="button"
        class="icon-button"
        aria-label="Details for {item.file.name}"
        onclick={onDetails}><Info size={16} /></button
      >
    {/if}
    {#if !(job.status === 'running' || job.status === 'waiting') || !current}
      <button
        type="button"
        class="icon-button"
        aria-label="Remove {item.file.name}"
        onclick={() => files.remove(item.id)}><X size={16} /></button
      >
    {/if}
  </div>

  {#if job.status === 'running' && current}
    <div class="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-sunken">
      {#if measured}
        <div
          class="h-full bg-accent transition-[width] duration-300"
          style:width="{progress * 100}%"
        ></div>
      {:else}
        <div class="indeterminate h-full w-1/3 bg-accent"></div>
      {/if}
    </div>
  {/if}
</article>
