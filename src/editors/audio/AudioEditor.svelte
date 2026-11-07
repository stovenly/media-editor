<script lang="ts">
  import { untrack } from 'svelte';
  import {
    Download,
    LoaderCircle,
    Pause,
    Play,
    Plus,
    Redo2,
    Scissors,
    Square,
    Trash2,
    Undo2,
    Volume2,
    VolumeX,
  } from '@lucide/svelte';
  import { Dialog } from 'bits-ui';
  import { formatBytes } from '../../app/format';
  import IconToggle from '../../app/ui/IconToggle.svelte';
  import NumberField from '../../app/ui/NumberField.svelte';
  import QualityPicker from '../../app/ui/QualityPicker.svelte';
  import Section from '../../app/ui/Section.svelte';
  import Segmented, { type SegmentedOption } from '../../app/ui/Segmented.svelte';
  import Select, { type SelectOption } from '../../app/ui/Select.svelte';
  import Slider from '../../app/ui/Slider.svelte';
  import Switch from '../../app/ui/Switch.svelte';
  import { files, type FileItem } from '../../converter/files.svelte';
  import { wakeLock } from '../../converter/wake-lock.svelte';
  import { hub } from '../../engine';
  import { messageOf } from '../../engine/errors';
  import { audioBitrate } from '../../engine/av/plan';
  import { target, TARGETS } from '../../engine/targets';
  import { downloadBlob } from '../../io/download';
  import { History } from '../../project/history.svelte';
  import {
    addTrack,
    appendToTrack,
    clipLength,
    crossfade,
    deleteRange,
    findClip,
    insertSilence,
    moveClip,
    newProject,
    projectDuration,
    removeClip,
    splitAt,
    trimClip,
    updateClip,
    type AudioProject,
  } from '../../project/audio';
  import { DEFAULT_OPTIONS } from '../../converter/options';
  import { outputName, startJob } from '../../converter/run';
  import { saveProject } from '../../project/save';
  import ProjectMenu from '../../project/ProjectMenu.svelte';
  import type { Restore } from '../editing.svelte';
  import OverallVolume from '../shared/OverallVolume.svelte';
  import PlaybackVolume from '../shared/PlaybackVolume.svelte';
  import { audioFileFor } from './prepare';
  import { AudioSession } from './session.svelte';
  import Timeline, { type Selection } from './Timeline.svelte';

  let { item, restore, onClose }: { item: FileItem; restore?: Restore; onClose: () => void } =
    $props();

  const COMMON_FORMATS = ['mp3', 'm4a', 'wav', 'flac'];
  const EXPORT_FORMATS: SelectOption<string>[] = TARGETS.filter((t) => t.group === 'audio')
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((t) => ({ value: t.id, label: t.label }));
  function rank(id: string) {
    const index = COMMON_FORMATS.indexOf(id);
    return index < 0 ? COMMON_FORMATS.length : index;
  }
  const NORMALISE_MODES: SegmentedOption<AudioProject['normalize']['mode']>[] = [
    { value: 'off', label: 'Off' },
    { value: 'peak', label: 'Peak', tooltip: 'Loudest peak at −1 dB' },
    { value: 'lufs', label: 'Loudness' },
  ];
  const LOUDNESS_TARGETS: SegmentedOption<number>[] = [
    { value: -14, label: 'Streaming' },
    { value: -16, label: 'Podcast' },
    { value: -23, label: 'Broadcast' },
  ];
  const CHANNEL_OPS: SelectOption<AudioProject['channelOp']>[] = [
    { value: 'none', label: 'As recorded' },
    { value: 'mono', label: 'Mix to mono' },
    { value: 'swap', label: 'Swap left and right' },
    { value: 'left', label: 'Left channel only' },
    { value: 'right', label: 'Right channel only' },
  ];
  const SAMPLE_RATES = [96000, 48000, 44100, 32000, 22050];
  const session = new AudioSession();
  const history = new History<AudioProject | null>(null);
  const project = $derived(history.state);

  let preparing = $state<string | null>('Opening…');
  let pps = $state(40);
  let selection = $state<Selection>(null);
  let selectedClip = $state<string | null>(null);
  let silenceSeconds = $state(1);

  let exportTarget = $state('mp3');
  let exportQuality = $state(100);
  let exportMb = $state<number | null>(null);
  let exporting = $state<{ jobId: string | null; stage: string } | null>(null);
  let exported = $state<{ blob: Blob; name: string; notes: string[] } | null>(null);
  // Follows the converter's "download when done" setting; reading it untracked keeps a toggle from
  // re-downloading the last export.
  $effect(() => {
    const done = exported;
    if (done && untrack(() => files.autoDownload)) downloadBlob(done.blob, done.name);
  });

  let exportError = $state<string | null>(null);

  const others = $derived(
    files.items.filter(
      (i) =>
        i.id !== item.id &&
        i.status === 'ready' &&
        (i.inspection?.sniffed.kind === 'audio' || i.inspection?.av?.audio),
    ),
  );
  const assetName = (id: string) => session.assets.find((a) => a.id === id)?.name ?? '';
  const assetDuration = (id: string) => session.assets.find((a) => a.id === id)?.duration ?? 0;

  async function load(source: FileItem) {
    preparing = `Preparing ${source.file.name}…`;
    try {
      const file = await audioFileFor(source);
      const [info] = await session.open([{ id: source.id, file }]);
      return info!;
    } finally {
      preparing = null;
    }
  }

  let projectMenu = $state<ReturnType<typeof ProjectMenu>>();

  async function start() {
    if (restore?.kind === 'audio') {
      for (const source of restore.items) await load(source);
      history.reset(restore.project);
    } else {
      history.reset(newProject([await load(item)]));
    }
  }
  start().catch((error: unknown) => (session.error = messageOf(error)));

  async function save(bundle: boolean) {
    if (!project) return;
    const ids = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.assetId)));
    const items = files.items.filter((i) => ids.has(i.id));
    await saveProject(item.file.name, { kind: 'audio', project }, items, { bundle });
  }

  $effect(() => () => session.close());

  const duration = $derived(project ? projectDuration(project) : 0);
  const sampleRates = $derived<SelectOption<string>[]>(
    [...new Set([...SAMPLE_RATES, project?.sampleRate ?? 44100])]
      .sort((a, b) => b - a)
      .map((rate) => ({ value: String(rate), label: `${rate / 1000} kHz` })),
  );
  const selected = $derived(project && selectedClip ? findClip(project, selectedClip) : null);
  const announcement = $derived.by(() => {
    if (!project || !selected) return '';
    const { track, clip } = selected;
    return `Selected ${assetName(clip.assetId)} on track ${project.tracks.indexOf(track) + 1}, ${clip.start.toFixed(1)} to ${(clip.start + clipLength(clip)).toFixed(1)} seconds`;
  });

  function estimate(quality: number): number | null {
    if (!project) return null;
    const seconds = duration / project.speed;
    const t = exportTarget;
    if (t === 'wav' || t === 'aiff' || t === 'au' || t === 'caf')
      return seconds * project.sampleRate * project.channels * 2;
    if (t === 'flac' || t === 'alac' || t === 'wv')
      return seconds * project.sampleRate * project.channels * 1.2;
    return (seconds * audioBitrate(quality, project.channels)) / 8;
  }

  const apply = (label: string, next: AudioProject) => history.apply(label, next);
  const edit = (label: string, fn: (p: AudioProject) => AudioProject) =>
    project && apply(label, fn(project));

  const END_SLACK = 0.05; // seconds from the end that count as the end, so Play starts over

  function play() {
    if (project && !session.playing)
      void session.play(project, session.position >= duration - END_SLACK ? 0 : session.position);
  }

  function stop() {
    session.stop();
    session.seek(0);
  }

  function seek(time: number) {
    const playing = session.playing;
    session.stop();
    session.seek(time);
    if (playing && project) void session.play(project, time);
  }

  function split() {
    edit('Split', (p) => splitAt(p, session.position, selection?.trackId ?? undefined));
  }

  function deleteSelection() {
    if (selection && selection.to > selection.from) {
      const { from, to, trackId } = selection;
      edit('Delete', (p) => deleteRange(p, from, to, trackId ? [trackId] : undefined));
      selection = null;
      seek(from);
    } else if (selectedClip) {
      const id = selectedClip;
      edit('Remove clip', (p) => removeClip(p, id));
      selectedClip = null;
    }
  }

  async function add(other: FileItem, mode: 'append' | 'track') {
    const info = await load(other);
    edit(mode === 'append' ? 'Join' : 'Add track', (p) =>
      mode === 'append'
        ? appendToTrack(p, p.tracks[0]!.id, info)
        : addTrack(p, info, session.position),
    );
  }

  async function runExport() {
    if (!project) return;
    exported = null;
    exportError = null;
    exporting = { jobId: null, stage: 'Exporting' };
    wakeLock.hold('audio-export');
    try {
      const out = target(exportTarget);
      const result = await session.export(
        project,
        {
          target: exportTarget,
          quality: exportQuality,
          kbps: null,
          targetBytes: exportMb ? exportMb * 1_000_000 : null,
        },
        (jobId) => (exporting = { jobId, stage: 'Exporting' }),
      );
      const stem = item.file.name.replace(/\.[^.]+$/, '');
      if (!result.intermediate) {
        exported = {
          blob: new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: out.mime }),
          name: `${stem}.${out.ext}`,
          notes: result.notes,
        };
        return;
      }
      exporting = { jobId: null, stage: `Encoding ${out.label}` };
      const wav = new File([result.bytes as Uint8Array<ArrayBuffer>], `${stem}.wav`, {
        type: 'audio/wav',
      });
      const job = startJob({
        file: wav,
        inspection: {
          sniffed: { format: 'wav', kind: 'audio', label: 'WAV audio' },
          pages: 1,
          duration: result.duration,
          av: {
            native: true,
            container: 'WAVE',
            subtitles: [],
            duration: result.duration,
            audio: {
              codec: 'pcm-s16',
              sampleRate: project.sampleRate,
              channels: project.channels,
              bitrate: null,
              decodable: true,
            },
            tags: { location: false, title: null, hasCover: false },
          },
        },
        targetId: exportTarget,
        options: { ...DEFAULT_OPTIONS, quality: exportQuality, targetMb: exportMb },
        threads: 1,
        onTask: (taskId) => (exporting = { jobId: taskId, stage: `Encoding ${out.label}` }),
      });
      const output = await job.result;
      exported = {
        blob: output.blob,
        name: outputName(`${stem}.wav`, out.ext),
        notes: [...result.notes, ...output.notes],
      };
    } catch (error) {
      exportError = messageOf(error);
    } finally {
      exporting = null;
      wakeLock.release('audio-export');
    }
  }

  function setNormalise(mode: AudioProject['normalize']['mode'], target = -14) {
    if (!project) return;
    const normalize =
      mode === 'peak'
        ? { mode, db: -1 }
        : mode === 'lufs'
          ? { mode, target }
          : { mode: 'off' as const };
    apply('Normalise', { ...project, normalize });
  }

  function setTrack(id: string, patch: { gain?: number; muted?: boolean }, label: string) {
    if (!project) return;
    apply(label, {
      ...project,
      tracks: project.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
  }

  function keydown(event: KeyboardEvent) {
    const mod = event.ctrlKey || event.metaKey;
    if (
      (event.target as HTMLElement).closest(
        'input, select, textarea, [role=slider], [role=radio], [role=switch], [role=combobox], [role=listbox]',
      )
    )
      return;
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) history.redo();
      else history.undo();
    } else if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      history.redo();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      deleteSelection();
    }
  }

  const time = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
  const db = (gain: number) => 20 * Math.log10(Math.max(gain, 1e-6));
</script>

<svelte:window onkeydown={keydown} />

{#snippet volume(label: string, gain: number, onGain: (gain: number) => void)}
  <Slider
    {label}
    value={db(gain)}
    min={-30}
    max={12}
    step={0.5}
    decimals={1}
    defaultValue={0}
    unit="dB"
    signed
    onChange={(v) => onGain(10 ** (v / 20))}
  />
{/snippet}

{#snippet loudness(o: SegmentedOption<number>)}
  <span class="flex min-w-0 flex-col items-center leading-tight">
    <span>{o.label}</span>
    <span class="text-[10px] text-muted tabular-nums">−{Math.abs(o.value)} LUFS</span>
  </span>
{/snippet}

<p class="sr-only" aria-live="polite">{announcement}</p>

<Dialog.Root open onOpenChange={(open) => !open && onClose()}>
  <Dialog.Portal>
    <Dialog.Content class="fixed inset-0 z-50 flex flex-col bg-surface outline-none">
      <header class="flex flex-wrap items-center gap-2 border-b border-line bg-raised px-4 py-2.5">
        <Dialog.Title class="min-w-0 flex-1 truncate font-semibold"
          >Audio editor · {item.file.name}</Dialog.Title
        >
        <Dialog.Description class="sr-only"
          >Cut, join and mix audio, then export it.</Dialog.Description
        >
        <button
          type="button"
          class="icon-button"
          aria-label="Undo {history.undoLabel ?? ''}"
          disabled={!history.canUndo}
          onclick={() => history.undo()}><Undo2 size={16} /></button
        >
        <button
          type="button"
          class="icon-button"
          aria-label="Redo {history.redoLabel ?? ''}"
          disabled={!history.canRedo}
          onclick={() => history.redo()}><Redo2 size={16} /></button
        >
        {#if project}<ProjectMenu bind:this={projectMenu} onSave={save} />{/if}
        <Dialog.Close class="rounded-full px-3 py-1.5 text-sm text-muted hover:text-fg"
          >Close</Dialog.Close
        >
      </header>

      {#if session.error}
        <p class="m-auto max-w-md text-center text-danger">{session.error}</p>
      {:else if !project}
        <p class="m-auto inline-flex items-center gap-2 text-muted">
          <LoaderCircle size={16} class="animate-spin" />
          {preparing}
        </p>
      {:else}
        <div class="flex min-h-0 flex-1">
          <section class="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="grid size-10 place-items-center rounded-full bg-accent text-on-accent transition-colors hover:bg-accent-hover"
                aria-label={session.playing ? 'Pause' : 'Play'}
                onclick={() => (session.playing ? session.stop() : play())}
              >
                {#if session.playing}<Pause size={18} />{:else}<Play size={18} />{/if}
              </button>
              <button
                type="button"
                class="icon-button border border-line disabled:opacity-40"
                aria-label="Stop"
                onclick={stop}><Square size={14} /></button
              >
              <span class="font-mono text-sm tabular-nums"
                >{time(session.position)} / {time(duration)}</span
              >
              <PlaybackVolume {session} />
              <span class="mx-2 h-6 w-px bg-line"></span>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border border-line transition-colors enabled:hover:border-accent enabled:hover:text-accent px-3 py-1.5 text-sm"
                title="Split at the playhead"
                onclick={split}><Scissors size={14} /> Split</button
              >
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border border-line transition-colors enabled:hover:border-accent enabled:hover:text-accent px-3 py-1.5 text-sm disabled:opacity-40"
                disabled={!selection && !selectedClip}
                title="Delete the selection (Delete)"
                onclick={deleteSelection}><Trash2 size={14} /> Delete</button
              >
              <div class="inline-flex items-center gap-1.5 text-sm">
                <button
                  type="button"
                  class="rounded-full border border-line transition-colors enabled:hover:border-accent enabled:hover:text-accent px-3 py-1.5"
                  onclick={() =>
                    edit('Insert silence', (p) =>
                      insertSilence(p, session.position, silenceSeconds),
                    )}>Insert silence</button
                >
                <div class="w-20">
                  <NumberField
                    label="Seconds of silence"
                    hideLabel
                    value={silenceSeconds}
                    min={0.1}
                    step={0.1}
                    unit="s"
                    onChange={(s) => (silenceSeconds = s)}
                  />
                </div>
              </div>
              <label class="ml-auto inline-flex items-center gap-2 text-xs text-muted">
                Zoom
                <input
                  type="range"
                  min="2"
                  max="400"
                  step="1"
                  bind:value={pps}
                  class="w-32 accent-accent"
                />
              </label>
            </div>

            <Timeline
              {project}
              peaks={session.peaks}
              {pps}
              position={session.position}
              {selection}
              {selectedClip}
              onSeek={seek}
              onSelect={(s) => (selection = s)}
              onSelectClip={(id) => (selectedClip = id)}
              onMove={(id, start, trackId) =>
                apply('Move clip', moveClip(project, id, start, trackId))}
              onTrim={(id, edge, t) =>
                apply(
                  'Trim',
                  trimClip(
                    project,
                    id,
                    edge,
                    t,
                    assetDuration(findClip(project, id)?.clip.assetId ?? ''),
                  ),
                )}
            />
            {#if selection}
              <p class="text-xs text-muted">
                Selected {time(selection.from)} – {time(selection.to)} ({(
                  selection.to - selection.from
                ).toFixed(2)} s)
              </p>
            {/if}

            {#if others.length}
              <div class="space-y-1.5 rounded-2xl border border-line bg-raised p-3 text-sm">
                <p class="font-medium">Other audio in your batch</p>
                {#each others as other (other.id)}
                  <div class="flex items-center gap-2">
                    <span class="min-w-0 flex-1 truncate">{other.file.name}</span>
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-full border border-line transition-colors enabled:hover:border-accent enabled:hover:text-accent px-2.5 py-1 text-xs"
                      aria-label="Join {other.file.name} at the end"
                      onclick={() => add(other, 'append')}><Plus size={12} /> Join at end</button
                    >
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-full border border-line transition-colors enabled:hover:border-accent enabled:hover:text-accent px-2.5 py-1 text-xs"
                      aria-label="Add {other.file.name} on a new track at the playhead"
                      onclick={() => add(other, 'track')}
                      ><Plus size={12} /> New track at playhead</button
                    >
                  </div>
                {/each}
              </div>
            {/if}
          </section>

          <aside
            class="w-80 shrink-0 space-y-5 overflow-y-auto border-l border-line bg-raised p-4 text-sm"
          >
            {#if selected}
              {@const fadeMax = Math.max(0.1, Math.min(10, clipLength(selected.clip) / 2))}
              <section class="space-y-2">
                <h3 class="font-medium">Clip · {assetName(selected.clip.assetId)}</h3>
                {@render volume('Volume', selected.clip.gain, (gain) =>
                  apply('Clip volume', updateClip(project, selected.clip.id, { gain })),
                )}
                <Slider
                  label="Fade in"
                  value={selected.clip.fadeIn}
                  min={0}
                  max={fadeMax}
                  step={0.1}
                  defaultValue={0}
                  unit="s"
                  onChange={(fadeIn) =>
                    apply('Fade in', updateClip(project, selected.clip.id, { fadeIn }))}
                />
                <Slider
                  label="Fade out"
                  value={selected.clip.fadeOut}
                  min={0}
                  max={fadeMax}
                  step={0.1}
                  defaultValue={0}
                  unit="s"
                  onChange={(fadeOut) =>
                    apply('Fade out', updateClip(project, selected.clip.id, { fadeOut }))}
                />
                <button
                  type="button"
                  class="rounded-full border border-line transition-colors enabled:hover:border-accent enabled:hover:text-accent px-3 py-1 text-xs"
                  onclick={() => apply('Crossfade', crossfade(project, selected.clip.id, 1))}
                  >Crossfade into the next clip (1 s)</button
                >
              </section>
              <section class="space-y-2">
                <h3 class="font-medium">Track</h3>
                <div class="flex items-start gap-2">
                  <div class="min-w-0 flex-1">
                    {@render volume('Track volume', selected.track.gain, (gain) =>
                      setTrack(selected.track.id, { gain }, 'Track volume'),
                    )}
                  </div>
                  <div class="mt-5.5">
                    <IconToggle
                      label="Mute this track"
                      pressed={selected.track.muted}
                      icon={Volume2}
                      pressedIcon={VolumeX}
                      onChange={(muted) => setTrack(selected.track.id, { muted }, 'Mute')}
                    />
                  </div>
                </div>
              </section>
            {/if}

            <section class="space-y-2">
              <h3 class="font-medium">Whole mix</h3>
              <OverallVolume
                gain={project.gain ?? 1}
                disabled={project.normalize.mode !== 'off'}
                onChange={(gain) => apply('Overall volume', { ...project, gain })}
              />
              <Segmented
                label="Normalise"
                options={NORMALISE_MODES}
                value={project.normalize.mode}
                onChange={(mode) => setNormalise(mode)}
              />
              {#if project.normalize.mode === 'lufs'}
                <Segmented
                  label="Loudness target"
                  options={LOUDNESS_TARGETS}
                  value={project.normalize.target}
                  option={loudness}
                  onChange={(target) => setNormalise('lufs', target)}
                />
              {/if}
              <Switch
                label="Remove silence at the start and end"
                checked={project.trimSilence}
                onChange={(trimSilence) => apply('Trim silence', { ...project, trimSilence })}
              />
              <Select
                label="Channels"
                options={CHANNEL_OPS}
                value={project.channelOp}
                onChange={(channelOp) => apply('Channels', { ...project, channelOp })}
              />
              <Slider
                label="Speed (pitch kept)"
                value={project.speed}
                min={0.5}
                max={2}
                step={0.05}
                defaultValue={1}
                unit="×"
                marks={[{ value: 1, label: '1×' }]}
                onChange={(speed) => apply('Speed', { ...project, speed })}
              />
            </section>

            <Section id="audio-advanced" title="Advanced" defaultOpen={false}>
              <Select
                label="Sample rate"
                options={sampleRates}
                value={String(project.sampleRate)}
                onChange={(rate) => apply('Sample rate', { ...project, sampleRate: Number(rate) })}
              />
            </Section>

            <section class="space-y-2">
              <h3 class="font-medium">Export</h3>
              <Select
                label="Export format"
                options={EXPORT_FORMATS}
                value={exportTarget}
                onChange={(id) => (exportTarget = id)}
              />
              <QualityPicker
                quality={exportQuality}
                targetMb={exportMb}
                {estimate}
                onChange={(q) => (exportQuality = q)}
                onTargetMb={(mb) => (exportMb = mb)}
              />
              {#if exporting}
                <p class="inline-flex items-center gap-2 text-muted">
                  <LoaderCircle size={14} class="animate-spin" />
                  {exporting.stage}{#if exporting.jobId}
                    · {Math.round((hub.latest.get(exporting.jobId) ?? 0) * 100)}%{/if}
                </p>
              {:else}
                <button
                  type="button"
                  class="w-full rounded-full bg-accent px-4 py-2 font-medium text-on-accent hover:bg-accent-hover"
                  onclick={runExport}>Export</button
                >
              {/if}
              {#if !exporting}
                <Switch
                  label="Download when it's done"
                  checked={files.autoDownload}
                  onChange={(on) => files.setAutoDownload(on)}
                />
              {/if}
              {#if exportError}<p class="text-danger">{exportError}</p>{/if}
              {#if exported}
                <div class="space-y-1 rounded-xl bg-sunken p-3">
                  <p>{exported.name} · {formatBytes(exported.blob.size)}</p>
                  {#each exported.notes as note (note)}<p class="text-xs text-muted">
                      {note}
                    </p>{/each}
                  <button
                    type="button"
                    class="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-accent"
                    aria-label="Download {exported.name}"
                    onclick={() => exported && downloadBlob(exported.blob, exported.name)}
                    ><Download size={14} /> Download</button
                  >
                </div>
              {/if}
            </section>
          </aside>
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
