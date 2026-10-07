<script lang="ts">
  import { Captions as CaptionsIcon, Download, Plus, Trash2, Upload } from '@lucide/svelte';
  import {
    newCue,
    shiftCues,
    writeSubtitles,
    type Cue,
    type SubtitleFormat,
  } from '../../captions/cues';
  import { inspectPool, scheduler } from '../../engine';
  import { messageOf } from '../../engine/errors';
  import { downloadBlob } from '../../io/download';
  import type { Captions, ProjectFont } from '../../project/text';
  import TextStyleFields from './TextStyleFields.svelte';

  let {
    captions,
    selected,
    position,
    fonts,
    name,
    onChange,
    onSelect,
    onSeek,
    onAddFont,
  }: {
    captions: Captions;
    selected: string | null;
    position: number;
    fonts: readonly ProjectFont[];
    name: string;
    onChange: (label: string, patch: Partial<Captions>) => void;
    onSelect: (id: string | null) => void;
    onSeek: (time: number) => void;
    onAddFont: (file: File) => Promise<string | null>;
  } = $props();

  let picker = $state<HTMLInputElement>();
  let error = $state<string | null>(null);
  let nudge = $state(0.5);
  let saveAs = $state<SubtitleFormat>('srt');

  const cue = $derived(captions.cues.find((c) => c.id === selected) ?? null);
  const num = (event: Event) => Number((event.currentTarget as HTMLInputElement).value);
  const time = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

  function setCues(label: string, cues: Cue[]) {
    onChange(label, { cues: [...cues].sort((a, b) => a.start - b.start) });
  }

  function patchCue(label: string, patch: Partial<Cue>) {
    if (cue)
      setCues(
        label,
        captions.cues.map((c) => (c.id === cue.id ? { ...c, ...patch } : c)),
      );
  }

  export async function importFile(file: File) {
    error = null;
    try {
      const task = scheduler.submit({
        pool: inspectPool,
        memory: 64 * 1024 * 1024 + file.size * 8,
        run: (api) => api.readCues(file),
      });
      const cues = await task.result;
      if (cues.length === 0) throw new Error('No captions found in this file');
      setCues('Import captions', [...captions.cues, ...cues]);
    } catch (e) {
      error = messageOf(e);
    }
  }

  function addAtPlayhead() {
    const next = captions.cues.find((c) => c.start > position);
    const added = newCue(position, 'New caption');
    if (next) added.end = Math.min(added.end, Math.max(position + 0.3, next.start));
    setCues('Add caption', [...captions.cues, added]);
    onSelect(added.id);
  }

  function save() {
    const text = writeSubtitles(captions.cues, saveAs);
    const mime =
      saveAs === 'vtt' ? 'text/vtt' : saveAs === 'ass' ? 'text/x-ssa' : 'application/x-subrip';
    downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), `${name}.${saveAs}`);
  }

  const field = 'w-full min-w-0 rounded-lg border border-line bg-surface px-2 py-1 text-sm';
  const pill =
    'inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs hover:border-accent disabled:opacity-40';
</script>

<section class="space-y-2" aria-labelledby="captions-heading">
  <h3 id="captions-heading" class="inline-flex items-center gap-1.5 font-medium">
    <CaptionsIcon size={14} /> Captions
    {#if captions.cues.length}<span class="font-normal text-muted">· {captions.cues.length}</span
      >{/if}
  </h3>

  {#if cue}
    <div class="space-y-2 rounded-xl border border-accent/40 p-2">
      <textarea
        class="{field} min-h-14"
        aria-label="Caption text"
        value={cue.text}
        oninput={(e) => patchCue('Caption text', { text: e.currentTarget.value })}></textarea>
      <div class="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <label class="grid gap-1 text-xs text-muted"
          >From (s)<input
            type="number"
            step="0.05"
            min="0"
            class={field}
            value={cue.start.toFixed(2)}
            onchange={(e) =>
              patchCue('Caption timing', {
                start: Math.max(0, Math.min(num(e), cue.end - 0.05)),
              })}
          /></label
        >
        <label class="grid gap-1 text-xs text-muted"
          >To (s)<input
            type="number"
            step="0.05"
            min="0"
            class={field}
            value={cue.end.toFixed(2)}
            onchange={(e) =>
              patchCue('Caption timing', { end: Math.max(cue.start + 0.05, num(e)) })}
          /></label
        >
        <button
          type="button"
          class="icon-button border border-line"
          aria-label="Delete this caption"
          onclick={() => {
            setCues(
              'Delete caption',
              captions.cues.filter((c) => c.id !== cue.id),
            );
            onSelect(null);
          }}><Trash2 size={14} /></button
        >
      </div>
    </div>
  {/if}

  <div class="flex flex-wrap gap-1.5">
    <button type="button" class={pill} onclick={() => picker?.click()}
      ><Upload size={12} /> Import SRT, VTT or ASS</button
    >
    <button type="button" class={pill} onclick={addAtPlayhead}
      ><Plus size={12} /> Add at playhead</button
    >
  </div>
  <input
    bind:this={picker}
    type="file"
    class="hidden"
    accept=".srt,.vtt,.ass,.ssa,text/vtt"
    aria-label="Subtitle file"
    onchange={(e) => {
      const file = e.currentTarget.files?.[0];
      e.currentTarget.value = '';
      if (file) void importFile(file);
    }}
  />
  {#if error}<p class="text-xs text-danger">{error}</p>{/if}

  {#if captions.cues.length}
    <ul class="max-h-48 space-y-0.5 overflow-y-auto rounded-xl bg-sunken p-1" aria-label="Captions">
      {#each captions.cues as c (c.id)}
        <li>
          <button
            type="button"
            class="flex w-full gap-2 rounded-lg px-2 py-1 text-left text-xs {c.id === selected
              ? 'bg-accent-soft'
              : 'hover:bg-raised'}"
            aria-current={c.id === selected}
            onclick={() => {
              onSelect(c.id);
              onSeek(c.start);
            }}
          >
            <span class="shrink-0 font-mono text-muted tabular-nums">{time(c.start)}</span>
            <span class="truncate">{c.text.replace(/\n/g, ' ')}</span>
          </button>
        </li>
      {/each}
    </ul>

    <div class="flex items-end gap-1.5">
      <label class="grid flex-1 gap-1 text-xs text-muted"
        >Move all by (s)<input type="number" step="0.1" class={field} bind:value={nudge} /></label
      >
      <button
        type="button"
        class={pill}
        aria-label="Move all captions earlier by {nudge} seconds"
        onclick={() => setCues('Move captions', shiftCues(captions.cues, -nudge))}>Earlier</button
      >
      <button
        type="button"
        class={pill}
        aria-label="Move all captions later by {nudge} seconds"
        onclick={() => setCues('Move captions', shiftCues(captions.cues, nudge))}>Later</button
      >
    </div>

    <label class="flex items-center gap-2 text-xs"
      ><input
        type="checkbox"
        checked={captions.burn}
        onchange={(e) => onChange('Burn in captions', { burn: e.currentTarget.checked })}
      /> Draw them into the picture</label
    >
    <label class="flex items-center gap-2 text-xs"
      ><input
        type="checkbox"
        checked={captions.track}
        onchange={(e) => onChange('Subtitle track', { track: e.currentTarget.checked })}
      /> Also add a subtitle track viewers can switch on</label
    >
    {#if captions.track}
      <label class="flex items-center gap-2 text-xs text-muted"
        >Language <input
          class="w-16 rounded-lg border border-line bg-surface px-2 py-0.5 text-sm"
          maxlength="3"
          placeholder="eng"
          value={captions.language}
          onchange={(e) =>
            onChange('Caption language', { language: e.currentTarget.value.trim().toLowerCase() })}
        /></label
      >
    {/if}

    <details class="rounded-xl border border-line px-2 py-1.5">
      <summary class="cursor-pointer text-xs font-medium">Caption style</summary>
      <div class="pt-2">
        <TextStyleFields
          style={captions.style}
          {fonts}
          onChange={(label, style) => onChange(`Caption ${label.toLowerCase()}`, { style })}
          {onAddFont}
        />
      </div>
    </details>

    <div class="flex items-center gap-1.5">
      <select class="{field} w-auto" bind:value={saveAs} aria-label="Caption file format">
        <option value="srt">SRT</option>
        <option value="vtt">WebVTT</option>
        <option value="ass">ASS</option>
      </select>
      <button type="button" class={pill} onclick={save}><Download size={12} /> Save captions</button
      >
    </div>
  {/if}
</section>
