<script lang="ts">
  import {
    Download,
    LoaderCircle,
    Pause,
    Play,
    Plus,
    Redo2,
    Scissors,
    SkipBack,
    Trash2,
    Undo2,
  } from '@lucide/svelte';
  import { Dialog } from 'bits-ui';
  import { formatBytes } from '../../app/format';
  import { files, type FileItem } from '../../converter/files.svelte';
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
  import { audioFileFor } from './prepare';
  import { AudioSession } from './session.svelte';
  import Timeline, { type Selection } from './Timeline.svelte';

  let { item, onClose }: { item: FileItem; onClose: () => void } = $props();

  const AUDIO_TARGETS = TARGETS.filter((t) => t.group === 'audio');
  const session = new AudioSession();
  const history = new History<AudioProject | null>(null);
  const project = $derived(history.state);

  let preparing = $state<string | null>('Opening…');
  let pps = $state(40);
  let selection = $state<Selection>(null);
  let selectedClip = $state<string | null>(null);
  let silenceSeconds = $state(1);

  let exportTarget = $state('mp3');
  let exportQuality = $state(82);
  let exportMb = $state<number | null>(null);
  let exporting = $state<{ jobId: string | null; stage: string } | null>(null);
  let exported = $state<{ blob: Blob; name: string; notes: string[] } | null>(null);
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

  // svelte-ignore state_referenced_locally
  load(item).then(
    (info) => history.reset(newProject([info])),
    (error: unknown) => (session.error = messageOf(error)),
  );

  $effect(() => () => session.close());

  const duration = $derived(project ? projectDuration(project) : 0);
  const selected = $derived(project && selectedClip ? findClip(project, selectedClip) : null);

  const estimate = $derived.by(() => {
    if (!project) return null;
    const seconds = duration / project.speed;
    if (exportMb) return exportMb * 1_000_000;
    const t = exportTarget;
    if (t === 'wav' || t === 'aiff' || t === 'au' || t === 'caf')
      return seconds * project.sampleRate * project.channels * 2;
    if (t === 'flac' || t === 'alac' || t === 'wv')
      return seconds * project.sampleRate * project.channels * 1.2;
    return (seconds * audioBitrate(exportQuality, project.channels)) / 8;
  });

  const apply = (label: string, next: AudioProject) => history.apply(label, next);
  const edit = (label: string, fn: (p: AudioProject) => AudioProject) =>
    project && apply(label, fn(project));

  function togglePlay() {
    if (!project) return;
    if (session.playing) session.stop();
    else void session.play(project, session.position >= duration ? 0 : session.position);
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
    }
  }

  function keydown(event: KeyboardEvent) {
    if ((event.target as HTMLElement).closest('input, select, textarea')) return;
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === ' ') {
      event.preventDefault();
      togglePlay();
    } else if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) history.redo();
      else history.undo();
    } else if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      history.redo();
    } else if (event.key.toLowerCase() === 's' && !mod) {
      split();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      deleteSelection();
    }
  }

  const time = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
  const db = (gain: number) => (20 * Math.log10(Math.max(gain, 1e-6))).toFixed(1);
  const value = (event: Event) => Number((event.currentTarget as HTMLInputElement).value);
</script>

<svelte:window onkeydown={keydown} />

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
        <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
          <section class="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="icon-button border border-line"
                aria-label="Back to start"
                onclick={() => seek(0)}><SkipBack size={16} /></button
              >
              <button
                type="button"
                class="grid size-10 place-items-center rounded-full bg-accent text-on-accent"
                aria-label={session.playing ? 'Pause' : 'Play'}
                onclick={togglePlay}
              >
                {#if session.playing}<Pause size={18} />{:else}<Play size={18} />{/if}
              </button>
              <span class="font-mono text-sm tabular-nums"
                >{time(session.position)} / {time(duration)}</span
              >
              <span class="mx-2 h-6 w-px bg-line"></span>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm"
                title="Split at the playhead (S)"
                onclick={split}><Scissors size={14} /> Split</button
              >
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm disabled:opacity-40"
                disabled={!selection && !selectedClip}
                title="Delete the selection (Delete)"
                onclick={deleteSelection}><Trash2 size={14} /> Delete</button
              >
              <label class="inline-flex items-center gap-1.5 text-sm">
                <button
                  type="button"
                  class="rounded-full border border-line px-3 py-1.5"
                  onclick={() =>
                    edit('Insert silence', (p) =>
                      insertSilence(p, session.position, silenceSeconds),
                    )}>Insert silence</button
                >
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  bind:value={silenceSeconds}
                  class="w-16 rounded-lg border border-line bg-surface px-2 py-1"
                  aria-label="Seconds of silence"
                /> s
              </label>
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
                      class="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs"
                      onclick={() => add(other, 'append')}><Plus size={12} /> Join at end</button
                    >
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs"
                      onclick={() => add(other, 'track')}
                      ><Plus size={12} /> New track at playhead</button
                    >
                  </div>
                {/each}
              </div>
            {/if}
          </section>

          <aside
            class="w-full shrink-0 space-y-5 overflow-y-auto border-t border-line bg-raised p-4 text-sm lg:w-80 lg:border-t-0 lg:border-l"
          >
            {#if selected}
              <section class="space-y-2">
                <h3 class="font-medium">Clip · {assetName(selected.clip.assetId)}</h3>
                <label class="grid gap-1 text-xs">
                  <span class="flex justify-between"
                    >Volume <span class="text-muted tabular-nums">{db(selected.clip.gain)} dB</span
                    ></span
                  >
                  <input
                    type="range"
                    min="-30"
                    max="12"
                    step="0.5"
                    value={Number(db(selected.clip.gain))}
                    class="accent-accent"
                    oninput={(e) =>
                      apply(
                        'Clip volume',
                        updateClip(project, selected.clip.id, { gain: 10 ** (value(e) / 20) }),
                      )}
                  />
                </label>
                <label class="grid gap-1 text-xs">
                  <span class="flex justify-between"
                    >Fade in <span class="text-muted tabular-nums"
                      >{selected.clip.fadeIn.toFixed(1)} s</span
                    ></span
                  >
                  <input
                    type="range"
                    min="0"
                    max={Math.min(10, clipLength(selected.clip) / 2)}
                    step="0.1"
                    value={selected.clip.fadeIn}
                    class="accent-accent"
                    oninput={(e) =>
                      apply('Fade in', updateClip(project, selected.clip.id, { fadeIn: value(e) }))}
                  />
                </label>
                <label class="grid gap-1 text-xs">
                  <span class="flex justify-between"
                    >Fade out <span class="text-muted tabular-nums"
                      >{selected.clip.fadeOut.toFixed(1)} s</span
                    ></span
                  >
                  <input
                    type="range"
                    min="0"
                    max={Math.min(10, clipLength(selected.clip) / 2)}
                    step="0.1"
                    value={selected.clip.fadeOut}
                    class="accent-accent"
                    oninput={(e) =>
                      apply(
                        'Fade out',
                        updateClip(project, selected.clip.id, { fadeOut: value(e) }),
                      )}
                  />
                </label>
                <button
                  type="button"
                  class="rounded-full border border-line px-3 py-1 text-xs"
                  onclick={() => apply('Crossfade', crossfade(project, selected.clip.id, 1))}
                  >Crossfade into the next clip (1 s)</button
                >
              </section>
              <section class="space-y-2">
                <h3 class="font-medium">Track</h3>
                <label class="grid gap-1 text-xs">
                  <span class="flex justify-between"
                    >Track volume <span class="text-muted tabular-nums"
                      >{db(selected.track.gain)} dB</span
                    ></span
                  >
                  <input
                    type="range"
                    min="-30"
                    max="12"
                    step="0.5"
                    value={Number(db(selected.track.gain))}
                    class="accent-accent"
                    oninput={(e) =>
                      apply('Track volume', {
                        ...project,
                        tracks: project.tracks.map((t) =>
                          t.id === selected.track.id ? { ...t, gain: 10 ** (value(e) / 20) } : t,
                        ),
                      })}
                  />
                </label>
                <label class="flex items-center gap-2 text-xs"
                  ><input
                    type="checkbox"
                    checked={selected.track.muted}
                    onchange={(e) =>
                      apply('Mute', {
                        ...project,
                        tracks: project.tracks.map((t) =>
                          t.id === selected.track.id
                            ? { ...t, muted: (e.currentTarget as HTMLInputElement).checked }
                            : t,
                        ),
                      })}
                  /> Mute this track</label
                >
              </section>
            {/if}

            <section class="space-y-2">
              <h3 class="font-medium">Whole mix</h3>
              <label class="grid gap-1 text-xs">
                Normalise
                <select
                  class="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                  value={project.normalize.mode === 'off'
                    ? 'off'
                    : project.normalize.mode === 'peak'
                      ? `peak:${project.normalize.db}`
                      : `lufs:${project.normalize.target}`}
                  onchange={(e) => {
                    const [mode, n] = (e.currentTarget as HTMLSelectElement).value.split(':');
                    const normalize =
                      mode === 'peak'
                        ? { mode: 'peak' as const, db: Number(n) }
                        : mode === 'lufs'
                          ? { mode: 'lufs' as const, target: Number(n) }
                          : { mode: 'off' as const };
                    apply('Normalise', { ...project, normalize });
                  }}
                >
                  <option value="off">Off</option>
                  <option value="peak:-1">Loudest peak at −1 dB</option>
                  <option value="lufs:-14">Streaming loudness (−14 LUFS)</option>
                  <option value="lufs:-16">Podcast loudness (−16 LUFS)</option>
                  <option value="lufs:-23">Broadcast loudness (−23 LUFS)</option>
                </select>
              </label>
              <label class="flex items-center gap-2 text-xs"
                ><input
                  type="checkbox"
                  checked={project.trimSilence}
                  onchange={(e) =>
                    apply('Trim silence', {
                      ...project,
                      trimSilence: (e.currentTarget as HTMLInputElement).checked,
                    })}
                /> Remove silence at the start and end</label
              >
              <label class="grid gap-1 text-xs">
                Channels
                <select
                  class="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                  value={project.channelOp}
                  onchange={(e) =>
                    apply('Channels', {
                      ...project,
                      channelOp: (e.currentTarget as HTMLSelectElement)
                        .value as AudioProject['channelOp'],
                    })}
                >
                  <option value="none">As recorded</option>
                  <option value="mono">Mix to mono</option>
                  <option value="swap">Swap left and right</option>
                  <option value="left">Left channel only</option>
                  <option value="right">Right channel only</option>
                </select>
              </label>
              <label class="grid gap-1 text-xs">
                <span class="flex justify-between"
                  >Speed (pitch kept) <span class="text-muted tabular-nums"
                    >{project.speed.toFixed(2)}×</span
                  ></span
                >
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.05"
                  value={project.speed}
                  class="accent-accent"
                  oninput={(e) => apply('Speed', { ...project, speed: value(e) })}
                />
              </label>
              <label class="grid gap-1 text-xs">
                Sample rate
                <select
                  class="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                  value={project.sampleRate}
                  onchange={(e) =>
                    apply('Sample rate', {
                      ...project,
                      sampleRate: Number((e.currentTarget as HTMLSelectElement).value),
                    })}
                >
                  {#each [96000, 48000, 44100, 32000, 22050] as rate (rate)}<option value={rate}
                      >{rate / 1000} kHz</option
                    >{/each}
                </select>
              </label>
            </section>

            <section class="space-y-2">
              <h3 class="font-medium">Export</h3>
              <select
                class="w-full rounded-lg border border-line bg-surface px-2 py-1.5"
                bind:value={exportTarget}
                aria-label="Export format"
              >
                {#each AUDIO_TARGETS as t (t.id)}<option value={t.id}>{t.label}</option>{/each}
              </select>
              <label class="grid gap-1 text-xs">
                <span class="flex justify-between"
                  ><span>Smaller file</span><span>Better quality</span></span
                >
                <input
                  type="range"
                  min="1"
                  max="100"
                  bind:value={exportQuality}
                  class="accent-accent"
                  aria-label="Quality"
                />
              </label>
              <label class="flex items-center gap-2 text-xs">
                Fit to
                <input
                  type="number"
                  min="0.1"
                  step="any"
                  placeholder="Off"
                  class="w-20 rounded-lg border border-line bg-surface px-2 py-1"
                  value={exportMb ?? ''}
                  onchange={(e) =>
                    (exportMb = (e.currentTarget as HTMLInputElement).value ? value(e) : null)}
                />
                MB
              </label>
              {#if estimate}<p class="text-xs text-muted">About {formatBytes(estimate)}</p>{/if}
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
