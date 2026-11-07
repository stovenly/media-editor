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
  import NumberField from '../../app/ui/NumberField.svelte';
  import Section from '../../app/ui/Section.svelte';
  import Segmented from '../../app/ui/Segmented.svelte';
  import Switch from '../../app/ui/Switch.svelte';
  import { CAPTION_STYLE, type Captions, type ProjectFont } from '../../project/text';
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

  const FORMATS: { value: SubtitleFormat; label: string }[] = [
    { value: 'srt', label: 'SRT' },
    { value: 'vtt', label: 'WebVTT' },
    { value: 'ass', label: 'ASS' },
  ];
  const field = 'w-full min-w-0 rounded-lg border border-line bg-surface px-2 py-1 text-sm';
  const pill =
    'inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs hover:border-accent disabled:opacity-40';
</script>

<Section
  id="captions"
  title="Captions"
  icon={CaptionsIcon}
  detail={captions.cues.length ? String(captions.cues.length) : undefined}
>
  {#if cue}
    <div class="space-y-2 rounded-xl border border-accent/40 p-2">
      <textarea
        class="{field} min-h-14"
        aria-label="Caption text"
        value={cue.text}
        oninput={(e) => patchCue('Caption text', { text: e.currentTarget.value })}></textarea>
      <div class="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <NumberField
          label="From"
          time
          step={0.05}
          min={0}
          value={cue.start}
          onChange={(start) =>
            patchCue('Caption timing', { start: Math.min(start, cue.end - 0.05) })}
        />
        <NumberField
          label="To"
          time
          step={0.05}
          min={0}
          value={cue.end}
          onChange={(end) => patchCue('Caption timing', { end: Math.max(cue.start + 0.05, end) })}
        />
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
      <div class="min-w-0 flex-1">
        <NumberField
          label="Move all by"
          unit="s"
          step={0.1}
          value={nudge}
          onChange={(v) => (nudge = v)}
        />
      </div>
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

    <Switch
      label="Draw them into the picture"
      checked={captions.burn}
      onChange={(burn) => onChange('Burn in captions', { burn })}
    />
    <Switch
      label="Also add a subtitle track viewers can switch on"
      checked={captions.track}
      onChange={(track) => onChange('Subtitle track', { track })}
    />
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

    <div class="rounded-xl border border-line px-2 py-1.5">
      <Section id="caption-style" title="Caption style" level={4} defaultOpen={false}>
        <TextStyleFields
          style={captions.style}
          defaults={CAPTION_STYLE}
          {fonts}
          onChange={(label, style) => onChange(`Caption ${label.toLowerCase()}`, { style })}
          {onAddFont}
        />
      </Section>
    </div>

    <div class="flex items-center gap-1.5">
      <div class="min-w-0 flex-1">
        <Segmented
          label="Caption file format"
          hideLabel
          options={FORMATS}
          value={saveAs}
          onChange={(format) => (saveAs = format)}
        />
      </div>
      <button type="button" class={pill} onclick={save}><Download size={12} /> Save captions</button
      >
    </div>
  {/if}
</Section>
