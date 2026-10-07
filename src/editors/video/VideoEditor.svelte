<script lang="ts">
  import {
    Camera,
    Captions as CaptionsIcon,
    ChevronLeft,
    ChevronRight,
    Download,
    FlipHorizontal2,
    FlipVertical2,
    Image as ImageIcon,
    Layers,
    LoaderCircle,
    Music,
    Pause,
    Play,
    Plus,
    Redo2,
    RotateCcw,
    RotateCw,
    Scissors,
    SquareDashed,
    Trash2,
    Type,
    Undo2,
  } from '@lucide/svelte';
  import { Dialog } from 'bits-ui';
  import { formatBytes } from '../../app/format';
  import { files, type FileItem } from '../../converter/files.svelte';
  import { hub } from '../../engine';
  import { messageOf } from '../../engine/errors';
  import { videoBitrate } from '../../engine/av/plan';
  import { downloadBlob } from '../../io/download';
  import { newId } from '../../project/audio';
  import { History } from '../../project/history.svelte';
  import type { Rect } from '../../project/image-edit';
  import {
    addMusic,
    addOverlay,
    addText,
    appendMain,
    ASPECTS,
    moveMain,
    newVideoProject,
    removeAny,
    splitMain,
    updateCaptions,
    updateCue,
    updateMain,
    updateMusic,
    updateOverlay,
    updateText,
    videoDuration,
    type MainClip,
    type TimedRedaction,
    type VideoProject,
  } from '../../project/video';
  import { saveProject } from '../../project/save';
  import ProjectMenu from '../../project/ProjectMenu.svelte';
  import type { Restore } from '../editing.svelte';
  import RedactOverlay from '../image/RedactOverlay.svelte';
  import CaptionsPanel from './CaptionsPanel.svelte';
  import { VideoSession } from './session.svelte';
  import TextPanel from './TextPanel.svelte';
  import VideoTimeline, { type MovableRow } from './VideoTimeline.svelte';

  let { item, restore, onClose }: { item: FileItem; restore?: Restore; onClose: () => void } =
    $props();

  const session = new VideoSession();
  const history = new History<VideoProject | null>(null);
  const project = $derived(history.state);

  let canvas = $state<HTMLCanvasElement>();
  let attached = false;
  let position = $state(0);
  let playing = $state(false);
  let pps = $state(30);
  let selected = $state<string | null>(null);
  let drawingRedaction = $state(false);

  let exportFormat = $state<'mp4' | 'webm'>('mp4');
  let exportQuality = $state(82);
  let exportMb = $state<number | null>(null);
  let exporting = $state<{ jobId: string; stage: string } | null>(null);
  let captionsPanel = $state<ReturnType<typeof CaptionsPanel>>();
  let exportError = $state<string | null>(null);
  let exported = $state<{ blob: Blob; name: string; notes: string[] } | null>(null);

  const bin = $derived(
    files.items.filter(
      (i) =>
        i.status === 'ready' &&
        (i.inspection?.sniffed.kind === 'image' ||
          i.inspection?.sniffed.kind === 'video' ||
          i.inspection?.sniffed.kind === 'audio' ||
          i.inspection?.sniffed.kind === 'subtitle'),
    ),
  );
  const duration = $derived(project ? videoDuration(project) : 0);
  const selectedMain = $derived(project?.main.find((c) => c.id === selected) ?? null);
  const selectedOverlay = $derived(project?.overlay.find((c) => c.id === selected) ?? null);
  const selectedMusic = $derived(project?.music.find((c) => c.id === selected) ?? null);
  const selectedRedaction = $derived(project?.redactions.find((r) => r.id === selected) ?? null);
  const selectedText = $derived(project?.texts.find((t) => t.id === selected) ?? null);

  let projectMenu = $state<ReturnType<typeof ProjectMenu>>();

  async function start() {
    if (restore?.kind === 'video') {
      for (const source of restore.items) await session.add(source);
      for (const font of restore.project.fonts) {
        const file = restore.fonts.get(font.id);
        if (file) await session.restoreFont(font, file).catch(() => {});
      }
      history.reset(restore.project);
      return;
    }
    const asset = await session.add(item);
    const fresh = newVideoProject(asset.hasVideo ? asset : undefined);
    history.reset(asset.kind === 'audio' ? addMusic(fresh, asset, 0) : appendMain(fresh, asset));
  }
  start().catch(() => {});

  async function save(bundle: boolean) {
    if (!project) return;
    const ids = new Set(
      [...project.main, ...project.overlay, ...project.music].map((c) => c.assetId),
    );
    const items = files.items.filter((i) => ids.has(i.id));
    const fonts = project.fonts.flatMap((font) => {
      const file = session.fontFiles.get(font.id);
      return file ? [{ font, file }] : [];
    });
    await saveProject(item.file.name, { kind: 'video', project }, items, { bundle, fonts });
  }

  $effect(() => () => session.close());

  $effect(() => {
    if (canvas && !attached) {
      attached = true;
      session.attachCanvas(canvas);
    }
  });

  $effect(() => {
    if (project && !playing) session.render(project, position);
  });

  // Playback position comes from the audio clock.
  $effect(() => {
    if (playing) position = session.audio.position;
  });
  $effect(() => {
    if (playing && !session.audio.playing) playing = false;
  });

  const apply = (label: string, next: VideoProject) => history.apply(label, next);

  async function addFromBin(source: FileItem, where: 'main' | 'overlay' | 'music') {
    if (!project) return;
    const asset = await session.add(source);
    const current = history.state!;
    if (where === 'main') apply('Add clip', appendMain(current, asset));
    else if (where === 'overlay') apply('Add overlay', addOverlay(current, asset, position));
    else apply('Add music', addMusic(current, asset, position));
  }

  async function togglePlay() {
    if (!project) return;
    if (playing) {
      session.stop();
      playing = false;
      return;
    }
    const from = position >= duration ? 0 : position;
    await session.play(project, from);
    playing = true;
  }

  function seek(time: number) {
    if (playing) {
      session.stop();
      playing = false;
    }
    position = Math.max(0, Math.min(time, duration));
  }

  function step(frames: number) {
    if (project) seek(position + frames / project.fps);
  }

  function setAspect(key: string) {
    if (!project) return;
    if (key === 'source') {
      const first = project.main.map((c) => session.assets.get(c.assetId)).find((a) => a?.hasVideo);
      if (first)
        apply('Aspect', {
          ...project,
          width: Math.round(first.width / 2) * 2,
          height: Math.round(first.height / 2) * 2,
        });
      return;
    }
    const [width, height] = ASPECTS[key as keyof typeof ASPECTS];
    apply('Aspect', { ...project, width, height });
  }

  async function saveFrame() {
    if (!project) return;
    try {
      const png = await session.snapshot(project, position);
      const stem = item.file.name.replace(/\.[^.]+$/, '');
      downloadBlob(png, `${stem}-${position.toFixed(2).replace('.', '_')}s.png`);
    } catch (error) {
      session.error = messageOf(error);
    }
  }

  function insertText() {
    if (!project) return;
    const next = addText(project, position);
    apply('Add text', next);
    selected = next.texts.at(-1)!.id;
  }

  function move(row: MovableRow, id: string, start: number) {
    if (!project) return;
    if (row === 'overlay') apply('Move overlay', updateOverlay(project, id, { start }));
    else if (row === 'music') apply('Move music', updateMusic(project, id, { start }));
    else if (row === 'text') apply('Move text', updateText(project, id, { start }));
    else {
      const cue = project.captions.cues.find((c) => c.id === id);
      if (cue)
        apply('Move caption', updateCue(project, id, { start, end: start + cue.end - cue.start }));
    }
  }

  async function addFont(file: File): Promise<string | null> {
    if (!history.state) return null;
    const font = await session.addFont(
      file,
      history.state.fonts.map((f) => f.family),
    );
    apply('Add font', { ...history.state, fonts: [...history.state.fonts, font] });
    return font.family;
  }

  function patchMain(label: string, patch: Partial<MainClip>) {
    if (project && selectedMain) apply(label, updateMain(project, selectedMain.id, patch));
  }

  function addRedaction(rect: Rect) {
    if (!project) return;
    const redaction: TimedRedaction = {
      id: newId('redact'),
      rect,
      from: position,
      to: Math.min(duration, position + 3),
      kind: 'fill',
      color: '#000000',
    };
    apply('Redact', { ...project, redactions: [...project.redactions, redaction] });
    selected = redaction.id;
    drawingRedaction = false;
  }

  function patchRedaction(patch: Partial<TimedRedaction>) {
    if (!project || !selectedRedaction) return;
    apply('Redaction', {
      ...project,
      redactions: project.redactions.map((r) =>
        r.id === selectedRedaction.id ? { ...r, ...patch } : r,
      ),
    });
  }

  const estimate = $derived(
    project
      ? exportMb
        ? exportMb * 1_000_000
        : ((videoBitrate(
            project.width,
            project.height,
            project.fps,
            exportQuality,
            exportFormat === 'mp4' ? 'avc' : 'vp9',
          ) +
            160_000) *
            duration) /
          8
      : null,
  );

  async function runExport() {
    if (!project) return;
    session.stop();
    playing = false;
    exportError = null;
    exported = null;
    try {
      const result = await session.export(
        project,
        {
          container: exportFormat,
          quality: exportQuality,
          targetBytes: exportMb ? exportMb * 1_000_000 : null,
          codec: null,
        },
        (jobId, stage) => (exporting = { jobId, stage }),
      );
      const stem = item.file.name.replace(/\.[^.]+$/, '');
      exported = {
        blob: new Blob([result.bytes as Uint8Array<ArrayBuffer>], {
          type: exportFormat === 'mp4' ? 'video/mp4' : 'video/webm',
        }),
        name: `${stem}-edit.${exportFormat}`,
        notes: result.notes,
      };
    } catch (error) {
      exportError = messageOf(error);
    } finally {
      exporting = null;
    }
  }

  function keydown(event: KeyboardEvent) {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void projectMenu?.save(false);
      return;
    }
    if ((event.target as HTMLElement).closest('input, select, textarea')) return;
    if (event.key === ' ') {
      event.preventDefault();
      void togglePlay();
    } else if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) history.redo();
      else history.undo();
    } else if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      history.redo();
    } else if (event.key.toLowerCase() === 't' && !mod && project) {
      insertText();
    } else if (event.key.toLowerCase() === 's' && !mod && project) {
      apply('Split', splitMain(project, position));
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected && project) {
      apply('Delete', removeAny(project, selected));
      selected = null;
    } else if (event.key === 'ArrowLeft') {
      step(-1);
    } else if (event.key === 'ArrowRight') {
      step(1);
    }
  }

  const time = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
  const db = (gain: number) => (20 * Math.log10(Math.max(gain, 1e-6))).toFixed(1);
  const num = (event: Event) => Number((event.currentTarget as HTMLInputElement).value);
  const field = 'w-full min-w-0 rounded-lg border border-line bg-surface px-2 py-1 text-sm';
</script>

<svelte:window onkeydown={keydown} />

<Dialog.Root open onOpenChange={(open) => !open && onClose()}>
  <Dialog.Portal>
    <Dialog.Content class="fixed inset-0 z-50 flex flex-col bg-surface outline-none">
      <header class="flex flex-wrap items-center gap-2 border-b border-line bg-raised px-4 py-2.5">
        <Dialog.Title class="min-w-0 flex-1 truncate font-semibold">
          Video editor · {item.file.name}
          {#if project}<span class="ml-2 text-sm font-normal text-muted tabular-nums"
              >{project.width}×{project.height} · {project.fps} fps</span
            >{/if}
        </Dialog.Title>
        <Dialog.Description class="sr-only">Cut, join, layer and export video.</Dialog.Description>
        {#if session.preparing}<span class="inline-flex items-center gap-1.5 text-sm text-muted"
            ><LoaderCircle size={14} class="animate-spin" /> {session.preparing}</span
          >{/if}
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

      {#if session.error && !project}
        <p class="m-auto max-w-md text-center text-danger">{session.error}</p>
      {:else}
        <div class="flex min-h-0 flex-1">
          <aside
            class="hidden w-60 shrink-0 space-y-2 overflow-y-auto border-r border-line bg-raised p-3 text-sm md:block"
          >
            <h3 class="font-medium">Media</h3>
            {#each bin as source (source.id)}
              {@const kind = source.inspection?.sniffed.kind}
              <div class="rounded-xl border border-line p-2">
                <p class="truncate" title={source.file.name}>{source.file.name}</p>
                <div class="mt-1.5 flex flex-wrap gap-1">
                  {#if kind === 'image' || kind === 'video'}
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs"
                      aria-label="Add {source.file.name} to the video track"
                      onclick={() => addFromBin(source, 'main')}><Plus size={11} /> Video</button
                    >
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs"
                      aria-label="Add {source.file.name} as an overlay"
                      onclick={() => addFromBin(source, 'overlay')}
                      ><Layers size={11} /> Overlay</button
                    >
                  {/if}
                  {#if kind === 'subtitle'}
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs"
                      aria-label="Add {source.file.name} as captions"
                      onclick={() => captionsPanel?.importFile(source.file)}
                      ><CaptionsIcon size={11} /> Captions</button
                    >
                  {:else if kind !== 'image'}
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs"
                      aria-label="Add {source.file.name} as music"
                      onclick={() => addFromBin(source, 'music')}><Music size={11} /> Music</button
                    >
                  {/if}
                </div>
              </div>
            {/each}
            <p class="text-xs text-muted">Add more files to the converter to use them here.</p>
          </aside>

          <section class="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <div class="relative mx-auto w-full max-w-4xl">
              <div
                class="relative mx-auto bg-black"
                style:aspect-ratio={project ? `${project.width} / ${project.height}` : '16 / 9'}
                style:max-height="55dvh"
              >
                <canvas
                  bind:this={canvas}
                  class="block size-full object-contain"
                  aria-label="Preview"
                ></canvas>
                {#if project && drawingRedaction}
                  <RedactOverlay
                    redactions={[]}
                    selected={null}
                    onDraw={addRedaction}
                    onSelect={() => {}}
                  />
                {/if}
                {#if !project}
                  <p
                    class="absolute inset-0 m-auto inline-flex items-center justify-center gap-2 text-muted"
                  >
                    <LoaderCircle size={16} class="animate-spin" /> Opening…
                  </p>
                {/if}
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="icon-button border border-line"
                aria-label="Previous frame"
                onclick={() => step(-1)}><ChevronLeft size={16} /></button
              >
              <button
                type="button"
                class="grid size-10 place-items-center rounded-full bg-accent text-on-accent"
                aria-label={playing ? 'Pause' : 'Play'}
                onclick={togglePlay}
              >
                {#if playing}<Pause size={18} />{:else}<Play size={18} />{/if}
              </button>
              <button
                type="button"
                class="icon-button border border-line"
                aria-label="Next frame"
                onclick={() => step(1)}><ChevronRight size={16} /></button
              >
              <span class="font-mono text-sm tabular-nums">{time(position)} / {time(duration)}</span
              >
              <span class="mx-1 h-6 w-px bg-line"></span>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm"
                title="Split at the playhead (S)"
                onclick={() => project && apply('Split', splitMain(project, position))}
                ><Scissors size={14} /> Split</button
              >
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm disabled:opacity-40"
                disabled={!selected}
                onclick={() =>
                  project &&
                  selected &&
                  (apply('Delete', removeAny(project, selected)), (selected = null))}
                ><Trash2 size={14} /> Delete</button
              >
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm"
                title="Add text at the playhead (T)"
                onclick={insertText}><Type size={14} /> Text</button
              >
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm {drawingRedaction
                  ? 'border-accent text-accent'
                  : 'border-line'}"
                aria-pressed={drawingRedaction}
                onclick={() => (drawingRedaction = !drawingRedaction)}
                ><SquareDashed size={14} /> Redact an area</button
              >
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm"
                title="Save the frame at the playhead as a PNG"
                onclick={saveFrame}><Camera size={14} /> Save frame</button
              >
              <label class="ml-auto inline-flex items-center gap-2 text-xs text-muted"
                >Zoom <input
                  type="range"
                  min="2"
                  max="200"
                  bind:value={pps}
                  class="w-28 accent-accent"
                /></label
              >
            </div>
            {#if drawingRedaction}<p class="text-xs text-muted">
                Drag over the preview. The area is covered for 3 seconds from the playhead; change
                the times in the panel.
              </p>{/if}
            {#if session.error && project}<p class="text-sm text-danger" role="alert">
                {session.error}
              </p>{/if}

            {#if project}
              <VideoTimeline
                {project}
                assets={session.assets}
                {pps}
                {position}
                {selected}
                onSeek={seek}
                onSelect={(id) => (selected = id)}
                onReorder={(id, index) => apply('Reorder', moveMain(project, id, index))}
                onMove={move}
              />
            {/if}
          </section>

          <aside
            class="w-80 shrink-0 space-y-5 overflow-y-auto border-l border-line bg-raised p-4 text-sm"
          >
            {#if project}
              {#if selectedMain}
                <section class="space-y-2">
                  <h3 class="font-medium">
                    Clip · {session.assets.get(selectedMain.assetId)?.name}
                  </h3>
                  <div class="grid grid-cols-2 gap-2">
                    <label class="grid gap-1 text-xs text-muted"
                      >Start in source (s)<input
                        type="number"
                        step="0.01"
                        min="0"
                        class={field}
                        value={selectedMain.in.toFixed(2)}
                        onchange={(e) =>
                          patchMain('Trim', {
                            in: Math.max(0, Math.min(num(e), selectedMain.out - 0.05)),
                          })}
                      /></label
                    >
                    <label class="grid gap-1 text-xs text-muted"
                      >End in source (s)<input
                        type="number"
                        step="0.01"
                        min="0"
                        class={field}
                        value={selectedMain.out.toFixed(2)}
                        onchange={(e) => {
                          const asset = session.assets.get(selectedMain.assetId);
                          const max = asset?.kind === 'image' ? 3600 : (asset?.duration ?? 0);
                          patchMain('Trim', {
                            out: Math.min(max, Math.max(num(e), selectedMain.in + 0.05)),
                          });
                        }}
                      /></label
                    >
                  </div>
                  <label class="grid gap-1 text-xs">
                    Speed
                    <select
                      class={field}
                      value={selectedMain.speed}
                      onchange={(e) => patchMain('Speed', { speed: num(e) })}
                    >
                      {#each [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as s (s)}<option value={s}
                          >{s}×</option
                        >{/each}
                    </select>
                  </label>
                  <label class="grid gap-1 text-xs">
                    <span class="flex justify-between"
                      >Volume <span class="text-muted">{db(selectedMain.volume)} dB</span></span
                    >
                    <input
                      type="range"
                      min="-30"
                      max="12"
                      step="0.5"
                      value={Number(db(selectedMain.volume))}
                      class="accent-accent"
                      oninput={(e) => patchMain('Volume', { volume: 10 ** (num(e) / 20) })}
                    />
                  </label>
                  <label class="flex items-center gap-2 text-xs"
                    ><input
                      type="checkbox"
                      checked={selectedMain.muted}
                      onchange={(e) =>
                        patchMain('Mute', { muted: (e.currentTarget as HTMLInputElement).checked })}
                    /> Mute this clip's sound</label
                  >
                  <div class="grid grid-cols-3 gap-2">
                    <label class="grid gap-1 text-xs text-muted"
                      >Fade in<input
                        type="number"
                        step="0.1"
                        min="0"
                        class={field}
                        value={selectedMain.fadeIn}
                        onchange={(e) => patchMain('Fade in', { fadeIn: Math.max(0, num(e)) })}
                      /></label
                    >
                    <label class="grid gap-1 text-xs text-muted"
                      >Fade out<input
                        type="number"
                        step="0.1"
                        min="0"
                        class={field}
                        value={selectedMain.fadeOut}
                        onchange={(e) => patchMain('Fade out', { fadeOut: Math.max(0, num(e)) })}
                      /></label
                    >
                    <label class="grid gap-1 text-xs text-muted"
                      >Crossfade<input
                        type="number"
                        step="0.1"
                        min="0"
                        class={field}
                        value={selectedMain.transition}
                        onchange={(e) =>
                          patchMain('Crossfade', { transition: Math.max(0, num(e)) })}
                      /></label
                    >
                  </div>
                  <div class="flex gap-1.5">
                    <button
                      type="button"
                      class="icon-button border border-line"
                      aria-label="Rotate left"
                      onclick={() =>
                        patchMain('Rotate', {
                          transform: {
                            ...selectedMain.transform,
                            rotate: ((selectedMain.transform.rotate + 270) %
                              360) as MainClip['transform']['rotate'],
                          },
                        })}><RotateCcw size={15} /></button
                    >
                    <button
                      type="button"
                      class="icon-button border border-line"
                      aria-label="Rotate right"
                      onclick={() =>
                        patchMain('Rotate', {
                          transform: {
                            ...selectedMain.transform,
                            rotate: ((selectedMain.transform.rotate + 90) %
                              360) as MainClip['transform']['rotate'],
                          },
                        })}><RotateCw size={15} /></button
                    >
                    <button
                      type="button"
                      class="icon-button border border-line"
                      aria-label="Flip horizontally"
                      onclick={() =>
                        patchMain('Flip', {
                          transform: {
                            ...selectedMain.transform,
                            flipH: !selectedMain.transform.flipH,
                          },
                        })}><FlipHorizontal2 size={15} /></button
                    >
                    <button
                      type="button"
                      class="icon-button border border-line"
                      aria-label="Flip vertically"
                      onclick={() =>
                        patchMain('Flip', {
                          transform: {
                            ...selectedMain.transform,
                            flipV: !selectedMain.transform.flipV,
                          },
                        })}><FlipVertical2 size={15} /></button
                    >
                  </div>
                  <label class="grid gap-1 text-xs">
                    Crop
                    <select
                      class={field}
                      onchange={(e) => {
                        const v = (e.currentTarget as HTMLSelectElement).value;
                        patchMain('Crop', {
                          transform: {
                            ...selectedMain.transform,
                            crop:
                              v === 'none'
                                ? null
                                : {
                                    x: Number(v),
                                    y: Number(v),
                                    width: 1 - 2 * Number(v),
                                    height: 1 - 2 * Number(v),
                                  },
                          },
                        });
                      }}
                    >
                      <option value="none">No crop</option>
                      <option value="0.05">Trim 5% from each edge</option>
                      <option value="0.1">Trim 10% from each edge</option>
                      <option value="0.2">Trim 20% from each edge</option>
                    </select>
                  </label>
                </section>
              {:else if selectedOverlay}
                <section class="space-y-2">
                  <h3 class="inline-flex items-center gap-1.5 font-medium">
                    <ImageIcon size={14} /> Overlay
                  </h3>
                  <div class="grid grid-cols-2 gap-2">
                    <label class="grid gap-1 text-xs text-muted"
                      >Starts at (s)<input
                        type="number"
                        step="0.1"
                        min="0"
                        class={field}
                        value={selectedOverlay.start.toFixed(1)}
                        onchange={(e) =>
                          apply(
                            'Overlay',
                            updateOverlay(project, selectedOverlay.id, {
                              start: Math.max(0, num(e)),
                            }),
                          )}
                      /></label
                    >
                    <label class="grid gap-1 text-xs text-muted"
                      >Lasts (s)<input
                        type="number"
                        step="0.1"
                        min="0.1"
                        class={field}
                        value={(selectedOverlay.out - selectedOverlay.in).toFixed(1)}
                        onchange={(e) =>
                          apply(
                            'Overlay',
                            updateOverlay(project, selectedOverlay.id, {
                              out: selectedOverlay.in + Math.max(0.1, num(e)),
                            }),
                          )}
                      /></label
                    >
                  </div>
                  <label class="grid gap-1 text-xs"
                    >Size<input
                      type="range"
                      min="0.05"
                      max="1"
                      step="0.01"
                      value={selectedOverlay.rect.width}
                      class="accent-accent"
                      oninput={(e) => {
                        const w = num(e);
                        const ratio = selectedOverlay.rect.height / selectedOverlay.rect.width;
                        apply(
                          'Overlay size',
                          updateOverlay(project, selectedOverlay.id, {
                            rect: {
                              ...selectedOverlay.rect,
                              width: w,
                              height: Math.min(1, w * ratio),
                            },
                          }),
                        );
                      }}
                    /></label
                  >
                  <label class="grid gap-1 text-xs"
                    >Opacity<input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={selectedOverlay.opacity}
                      class="accent-accent"
                      oninput={(e) =>
                        apply(
                          'Opacity',
                          updateOverlay(project, selectedOverlay.id, { opacity: num(e) }),
                        )}
                    /></label
                  >
                  <div class="grid grid-cols-3 gap-1 text-xs">
                    {#each [['Top left', 0.03, 0.03], ['Top', 0.5, 0.03], ['Top right', 0.97, 0.03], ['Left', 0.03, 0.5], ['Centre', 0.5, 0.5], ['Right', 0.97, 0.5], ['Bottom left', 0.03, 0.97], ['Bottom', 0.5, 0.97], ['Bottom right', 0.97, 0.97]] as const as [label, ax, ay] (label)}
                      <button
                        type="button"
                        class="rounded-lg border border-line px-1 py-1"
                        onclick={() => {
                          const r = selectedOverlay.rect;
                          const x = Math.min(1 - r.width, Math.max(0, ax - r.width * ax));
                          const y = Math.min(1 - r.height, Math.max(0, ay - r.height * ay));
                          apply(
                            'Overlay position',
                            updateOverlay(project, selectedOverlay.id, { rect: { ...r, x, y } }),
                          );
                        }}>{label}</button
                      >
                    {/each}
                  </div>
                </section>
              {:else if selectedMusic}
                <section class="space-y-2">
                  <h3 class="inline-flex items-center gap-1.5 font-medium">
                    <Music size={14} /> Music
                  </h3>
                  <label class="grid gap-1 text-xs text-muted"
                    >Starts at (s)<input
                      type="number"
                      step="0.1"
                      min="0"
                      class={field}
                      value={selectedMusic.start.toFixed(1)}
                      onchange={(e) =>
                        apply(
                          'Music',
                          updateMusic(project, selectedMusic.id, { start: Math.max(0, num(e)) }),
                        )}
                    /></label
                  >
                  <label class="grid gap-1 text-xs">
                    <span class="flex justify-between"
                      >Volume <span class="text-muted">{db(selectedMusic.volume)} dB</span></span
                    >
                    <input
                      type="range"
                      min="-40"
                      max="6"
                      step="0.5"
                      value={Number(db(selectedMusic.volume))}
                      class="accent-accent"
                      oninput={(e) =>
                        apply(
                          'Music volume',
                          updateMusic(project, selectedMusic.id, { volume: 10 ** (num(e) / 20) }),
                        )}
                    />
                  </label>
                  <label class="flex items-center gap-2 text-xs"
                    ><input
                      type="checkbox"
                      checked={selectedMusic.duck}
                      onchange={(e) =>
                        apply(
                          'Ducking',
                          updateMusic(project, selectedMusic.id, {
                            duck: (e.currentTarget as HTMLInputElement).checked,
                          }),
                        )}
                    /> Lower the music while clips have sound</label
                  >
                  <div class="grid grid-cols-2 gap-2">
                    <label class="grid gap-1 text-xs text-muted"
                      >Fade in (s)<input
                        type="number"
                        step="0.1"
                        min="0"
                        class={field}
                        value={selectedMusic.fadeIn}
                        onchange={(e) =>
                          apply(
                            'Music fade',
                            updateMusic(project, selectedMusic.id, { fadeIn: Math.max(0, num(e)) }),
                          )}
                      /></label
                    >
                    <label class="grid gap-1 text-xs text-muted"
                      >Fade out (s)<input
                        type="number"
                        step="0.1"
                        min="0"
                        class={field}
                        value={selectedMusic.fadeOut}
                        onchange={(e) =>
                          apply(
                            'Music fade',
                            updateMusic(project, selectedMusic.id, {
                              fadeOut: Math.max(0, num(e)),
                            }),
                          )}
                      /></label
                    >
                  </div>
                </section>
              {:else if selectedText}
                <TextPanel
                  clip={selectedText}
                  fonts={project.fonts}
                  onChange={(label, patch) =>
                    apply(label, updateText(project, selectedText.id, patch))}
                  onAddFont={addFont}
                />
              {:else if selectedRedaction}
                <section class="space-y-2">
                  <h3 class="font-medium">Covered area</h3>
                  <div class="grid grid-cols-2 gap-2">
                    <label class="grid gap-1 text-xs text-muted"
                      >From (s)<input
                        type="number"
                        step="0.1"
                        min="0"
                        class={field}
                        value={selectedRedaction.from.toFixed(1)}
                        onchange={(e) => patchRedaction({ from: Math.max(0, num(e)) })}
                      /></label
                    >
                    <label class="grid gap-1 text-xs text-muted"
                      >To (s)<input
                        type="number"
                        step="0.1"
                        min="0"
                        class={field}
                        value={selectedRedaction.to.toFixed(1)}
                        onchange={(e) =>
                          patchRedaction({ to: Math.max(selectedRedaction.from + 0.1, num(e)) })}
                      /></label
                    >
                  </div>
                  <select
                    class={field}
                    value={selectedRedaction.kind}
                    onchange={(e) =>
                      patchRedaction({
                        kind: (e.currentTarget as HTMLSelectElement)
                          .value as TimedRedaction['kind'],
                      })}
                  >
                    <option value="fill">Solid box (redact)</option>
                    <option value="pixelate">Pixelate (cosmetic)</option>
                    <option value="blur">Blur (cosmetic)</option>
                  </select>
                  {#if selectedRedaction.kind !== 'fill'}
                    <p class="rounded-xl bg-sunken px-3 py-2 text-xs text-warning">
                      Blur and pixelation can be partly reversed, more easily in video than in a
                      photo, because many frames add up. Use a solid box for anything that must stay
                      secret.
                    </p>
                  {/if}
                </section>
              {/if}

              <CaptionsPanel
                bind:this={captionsPanel}
                captions={project.captions}
                {selected}
                {position}
                fonts={project.fonts}
                name={item.file.name.replace(/\.[^.]+$/, '')}
                onChange={(label, patch) => apply(label, updateCaptions(project, patch))}
                onSelect={(id) => (selected = id)}
                onSeek={seek}
                onAddFont={addFont}
              />

              {#if project.redactions.length}
                <section class="space-y-1">
                  <h3 class="font-medium">Covered areas</h3>
                  {#each project.redactions as r, index (r.id)}
                    <button
                      type="button"
                      class="block w-full rounded-lg px-2 py-1 text-left text-xs {r.id === selected
                        ? 'bg-accent-soft'
                        : ''}"
                      onclick={() => ((selected = r.id), seek(r.from))}
                    >
                      {index + 1}. {r.kind === 'fill' ? 'Solid box' : r.kind} · {r.from.toFixed(
                        1,
                      )}–{r.to.toFixed(1)} s
                    </button>
                  {/each}
                </section>
              {/if}

              <section class="space-y-2">
                <h3 class="font-medium">Project</h3>
                <label class="grid gap-1 text-xs">
                  Shape
                  <select
                    class={field}
                    onchange={(e) => setAspect((e.currentTarget as HTMLSelectElement).value)}
                  >
                    <option value="">{project.width}×{project.height}</option>
                    <option value="source">Same as the first clip</option>
                    {#each Object.keys(ASPECTS) as key (key)}<option value={key}>{key}</option
                      >{/each}
                  </select>
                </label>
                <label class="grid gap-1 text-xs">
                  Clips that don't match the shape
                  <select
                    class={field}
                    value={project.fit}
                    onchange={(e) =>
                      apply('Fit', {
                        ...project,
                        fit: (e.currentTarget as HTMLSelectElement).value as VideoProject['fit'],
                      })}
                  >
                    <option value="contain">Fit inside, with bars</option>
                    <option value="cover">Fill, cropping the edges</option>
                  </select>
                </label>
                <label class="grid gap-1 text-xs">
                  Frame rate
                  <select
                    class={field}
                    value={project.fps}
                    onchange={(e) => apply('Frame rate', { ...project, fps: num(e) })}
                  >
                    {#each [24, 25, 30, 50, 60] as f (f)}<option value={f}>{f} fps</option>{/each}
                  </select>
                </label>
              </section>

              <section class="space-y-2">
                <h3 class="font-medium">Export</h3>
                <select class={field} bind:value={exportFormat} aria-label="Export format">
                  <option value="mp4">MP4 (H.264)</option>
                  <option value="webm">WebM (VP9)</option>
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
                <label class="flex items-center gap-2 text-xs"
                  >Fit to <input
                    type="number"
                    min="0.1"
                    step="any"
                    placeholder="Off"
                    class="w-20 rounded-lg border border-line bg-surface px-2 py-1"
                    value={exportMb ?? ''}
                    onchange={(e) =>
                      (exportMb = (e.currentTarget as HTMLInputElement).value ? num(e) : null)}
                  /> MB</label
                >
                {#if estimate}<p class="text-xs text-muted">About {formatBytes(estimate)}</p>{/if}
                {#if exporting}
                  <p class="inline-flex items-center gap-2 text-muted">
                    <LoaderCircle size={14} class="animate-spin" />
                    {exporting.stage} · {Math.round((hub.latest.get(exporting.jobId) ?? 0) * 100)}%
                  </p>
                {:else}
                  <button
                    type="button"
                    class="w-full rounded-full bg-accent px-4 py-2 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
                    disabled={duration <= 0}
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
            {/if}
          </aside>
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
