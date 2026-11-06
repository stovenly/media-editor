<script lang="ts">
  import { untrack } from 'svelte';
  import {
    Camera,
    Captions as CaptionsIcon,
    Crop as CropIcon,
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
    Square,
    Plus,
    Redo2,
    RotateCcw,
    RotateCw,
    Scissors,
    SquareDashed,
    Trash2,
    Copy,
    Type,
    Undo2,
  } from '@lucide/svelte';
  import { Dialog } from 'bits-ui';
  import { formatBytes } from '../../app/format';
  import { files, type FileItem } from '../../converter/files.svelte';
  import { wakeLock } from '../../converter/wake-lock.svelte';
  import { hub } from '../../engine';
  import { messageOf } from '../../engine/errors';
  import { videoBitrate } from '../../engine/av/plan';
  import { downloadBlob } from '../../io/download';
  import { History } from '../../project/history.svelte';
  import type { Rect } from '../../project/image-edit';
  import {
    addMusic,
    addOverlay,
    addText,
    appendMain,
    ASPECTS,
    addRedaction as placeRedaction,
    copyableCuts,
    hearOnlyLane,
    laneCount,
    seeOnlyLane,
    duplicateItem,
    fromFirstItem,
    laneItems,
    moveItem,
    moveToLane,
    newVideoProject,
    sourceBitsPerPixel,
    removeAny,
    resizeItem,
    splitAt,
    splitTarget,
    updateCaptions,
    updateMain,
    updateMusic,
    updateOverlay,
    updateRedaction,
    updateText,
    videoDuration,
    type MainClip,
    type TimedRedaction,
    type VideoProject,
  } from '../../project/video';
  import { saveProject } from '../../project/save';
  import ProjectMenu from '../../project/ProjectMenu.svelte';
  import type { Restore } from '../editing.svelte';
  import CropOverlay from '../image/CropOverlay.svelte';
  import RedactOverlay from '../image/RedactOverlay.svelte';
  import OverallVolume from '../shared/OverallVolume.svelte';
  import PlaybackVolume from '../shared/PlaybackVolume.svelte';
  import CaptionsPanel from './CaptionsPanel.svelte';
  import { VideoSession } from './session.svelte';
  import TextPanel from './TextPanel.svelte';
  import TransformBox from './TransformBox.svelte';
  import ChromaKeyFields from './ChromaKeyFields.svelte';
  import { MEDIA_ACCEPT } from '../../io/formats';
  import VideoTimeline from './VideoTimeline.svelte';

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
  let exportQuality = $state(100);
  let exportMb = $state<number | null>(null);
  let exporting = $state<{ jobId: string; stage: string } | null>(null);
  let preferCopy = $state(true);
  const copyable = $derived(
    project ? copyableCuts(fromFirstItem(project), session.assets) !== null : false,
  );
  const fastCopy = $derived(copyable && preferCopy);
  let captionsPanel = $state<ReturnType<typeof CaptionsPanel>>();
  let exportError = $state<string | null>(null);
  let exported = $state<{ blob: Blob; name: string; notes: string[] } | null>(null);
  // Follows the converter's "download when done" setting; reading it untracked keeps a toggle from
  // re-downloading the last export.
  $effect(() => {
    const done = exported;
    if (done && untrack(() => files.autoDownload)) downloadBlob(done.blob, done.name);
  });

  let mediaPicker = $state<HTMLInputElement>();
  // Preview only: the one layer seen or heard, or null for all of them.
  let soloView = $state<number | null>(null);
  let soloHear = $state<number | null>(null);
  const seen = $derived(
    project && soloView !== null && soloView < laneCount(project)
      ? seeOnlyLane(project, soloView)
      : project,
  );
  const heard = $derived(
    project && soloHear !== null && soloHear < laneCount(project)
      ? hearOnlyLane(project, soloHear)
      : project,
  );
  // Playback holds the project it started with, so a new solo stops it.
  $effect(() => {
    void soloView;
    void soloHear;
    untrack(() => playing && halt());
  });
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

  // Everything on the timeline, for announcements.
  const items = $derived.by(() => {
    if (!project) return [];
    const name = (id: string) => session.assets.get(id)?.name ?? '';
    const labels = new Map<string, string>([
      ...project.main.map((c) => [c.id, `Clip ${name(c.assetId)}`] as const),
      ...project.overlay.map((o) => [o.id, `Overlay ${name(o.assetId)}`] as const),
      ...project.texts.map((t) => [t.id, `Text ${t.text}`] as const),
      ...project.music.map((m) => [m.id, `Music ${name(m.assetId)}`] as const),
      ...project.redactions.map((r) => [r.id, 'Covered area'] as const),
    ]);
    return [
      ...laneItems(project).map((i) => ({ ...i, label: labels.get(i.id) ?? '' })),
      ...project.captions.cues.map((c) => ({
        id: c.id,
        start: c.start,
        end: c.end,
        label: `Caption ${c.text}`,
      })),
    ].sort((a, b) => a.start - b.start);
  });
  const announcement = $derived.by(() => {
    const item = items.find((i) => i.id === selected);
    return item
      ? `Selected ${item.label}, ${item.start.toFixed(1)} to ${item.end.toFixed(1)} seconds`
      : '';
  });

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
    if (cropView) session.render(cropView.project, cropView.time);
    else if (seen && !playing) session.render(seen, position);
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

  let reversing = $state(false);
  let reverseFrame = 0;
  $effect(() => () => cancelAnimationFrame(reverseFrame));

  function halt() {
    if (playing) {
      session.stop();
      playing = false;
    }
    cancelAnimationFrame(reverseFrame);
    reversing = false;
  }

  async function play() {
    if (!project || playing) return;
    halt();
    // Within a frame of the end counts as the end, so Play starts over.
    await session.play(seen!, position >= duration - 1 / project.fps ? 0 : position, heard!);
    playing = true;
  }

  // Walks the playhead back in real time without sound; each position renders like a seek.
  function playBackwards() {
    if (!project || reversing) return;
    halt();
    if (position <= 0) position = duration;
    reversing = true;
    let last = performance.now();
    const tick = (now: number) => {
      position = Math.max(0, position - (now - last) / 1000);
      last = now;
      if (position > 0) reverseFrame = requestAnimationFrame(tick);
      else reversing = false;
    };
    reverseFrame = requestAnimationFrame(tick);
  }

  // Shows the frame at the dragged edge: the first frame kept, or the last one.
  function trim(id: string, edge: 'start' | 'end', time: number) {
    if (!project) return;
    const next = resizeItem(project, session.assets, id, edge, time);
    apply('Change length', next);
    const item =
      laneItems(next).find((i) => i.id === id) ?? next.captions.cues.find((c) => c.id === id);
    if (!item) return;
    halt();
    position = edge === 'start' ? item.start : Math.max(item.start, item.end - 1 / next.fps);
  }

  const duplicable = $derived(
    !!project && !!selected && laneItems(project).some((i) => i.id === selected),
  );

  function duplicate() {
    if (!project || !selected) return;
    const copied = duplicateItem(project, selected);
    if (!copied) return;
    apply('Duplicate', copied.project);
    selected = copied.id;
  }

  // Cuts where the source frame on screen begins, so that frame starts the second part; a time between
  // frames would leave a sliver of the frame before.
  async function split() {
    if (!project) return;
    const at = position;
    const item = splitTarget(project, at, selected);
    if (!item) return;
    let time = at;
    const clip =
      project.main.find((c) => c.id === item.id) ?? project.overlay.find((o) => o.id === item.id);
    if (clip) {
      const speed = 'speed' in clip ? clip.speed : 1;
      const source = await session.frameStart(clip.assetId, clip.in + (at - item.start) * speed);
      if (source !== null && source > clip.in && source < clip.out)
        time = item.start + (source - clip.in) / speed;
    }
    // Applied to the timeline as it is now, which another split may have changed while this one waited.
    const latest = history.state;
    if (latest) apply('Split', splitAt(latest, time, item.id));
  }

  function stop() {
    halt();
    position = 0;
  }

  function seek(time: number) {
    halt();
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

  async function addFont(file: File): Promise<string | null> {
    if (!history.state) return null;
    const font = await session.addFont(
      file,
      history.state.fonts.map((f) => f.family),
    );
    apply('Add font', { ...history.state, fonts: [...history.state.fonts, font] });
    return font.family;
  }

  let cropping = $state<string | null>(null);

  // The cropped clip's whole oriented source frame, at the playhead, drawn alone for cropping on.
  const cropView = $derived.by(() => {
    if (!project || !cropping) return null;
    const clip = project.main.find((c) => c.id === cropping);
    const asset = clip && session.assets.get(clip.assetId);
    if (!clip || !asset) return null;
    const { width, height } = orientedSize(clip, asset);
    const local = Math.max(0, Math.min(position - clip.start, (clip.out - clip.in) / clip.speed));
    const at = Math.min(clip.out, clip.in + local * clip.speed);
    const single: MainClip = {
      ...clip,
      start: 0,
      lane: 0,
      in: at,
      out: at + 1,
      speed: 1,
      fadeIn: 0,
      fadeOut: 0,
      transform: { ...clip.transform, crop: null },
    };
    return {
      clip,
      time: 0,
      project: {
        ...project,
        width: Math.max(2, Math.round(width / 2) * 2),
        height: Math.max(2, Math.round(height / 2) * 2),
        main: [single],
        overlay: [],
        texts: [],
        redactions: [],
        captions: { ...project.captions, burn: false },
      },
    };
  });

  $effect(() => {
    if (cropping && !project?.main.some((c) => c.id === cropping)) cropping = null;
  });

  function orientedSize(clip: MainClip, asset: { width: number; height: number }) {
    const sideways = clip.transform.rotate === 90 || clip.transform.rotate === 270;
    return sideways
      ? { width: asset.height, height: asset.width }
      : { width: asset.width, height: asset.height };
  }

  // A centred crop with the project's shape: the largest that fits inside the clip.
  function fillCrop(clip: MainClip): Rect | null {
    const asset = session.assets.get(clip.assetId);
    if (!project || !asset) return null;
    const { width, height } = orientedSize(clip, asset);
    const target = project.width / project.height;
    const source = width / height;
    if (Math.abs(target - source) < 0.001) return null;
    return target < source
      ? { x: (1 - target / source) / 2, y: 0, width: target / source, height: 1 }
      : { x: 0, y: (1 - source / target) / 2, width: 1, height: source / target };
  }

  function setCrop(clip: MainClip, crop: Rect | null, label = 'Crop') {
    if (!project) return;
    const full =
      crop && crop.x <= 0.0005 && crop.y <= 0.0005 && crop.width >= 0.999 && crop.height >= 0.999;
    apply(
      label,
      updateMain(project, clip.id, { transform: { ...clip.transform, crop: full ? null : crop } }),
    );
  }

  function patchMain(label: string, patch: Partial<MainClip>) {
    if (project && selectedMain) apply(label, updateMain(project, selectedMain.id, patch));
  }

  function addRedaction(rect: Rect) {
    if (!project) return;
    const placed = placeRedaction(
      project,
      rect,
      position,
      Math.max(position + 0.1, Math.min(duration, position + 3)),
    );
    apply('Redact', placed.project);
    selected = placed.id;
    drawingRedaction = false;
  }

  function patchRedaction(patch: Partial<TimedRedaction>) {
    if (project && selectedRedaction)
      apply('Redaction', updateRedaction(project, selectedRedaction.id, patch));
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
            sourceBitsPerPixel(project, session.assets),
          ) +
            160_000) *
            duration) /
          8
      : null,
  );

  async function runExport() {
    if (!project) return;
    halt();
    exportError = null;
    exported = null;
    wakeLock.hold('video-export');
    try {
      const result = await session.export(
        fromFirstItem(project),
        {
          container: exportFormat,
          quality: exportQuality,
          targetBytes: exportMb ? exportMb * 1_000_000 : null,
          codec: null,
        },
        fastCopy,
        (jobId, stage) => (exporting = { jobId, stage }),
      );
      const stem = item.file.name.replace(/\.[^.]+$/, '');
      exported = {
        blob: new Blob([result.bytes as Uint8Array<ArrayBuffer>], {
          type: result.container === 'mp4' ? 'video/mp4' : 'video/webm',
        }),
        name: `${stem}-edit.${result.container}`,
        notes: result.notes,
      };
    } catch (error) {
      exportError = messageOf(error);
    } finally {
      exporting = null;
      wakeLock.release('video-export');
    }
  }

  function keydown(event: KeyboardEvent) {
    const mod = event.ctrlKey || event.metaKey;
    if ((event.target as HTMLElement).closest('input, select, textarea, [role=slider]')) return;
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) history.redo();
      else history.undo();
    } else if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      history.redo();
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected && project) {
      apply('Delete', removeAny(project, selected));
      selected = null;
    }
  }

  const time = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
  const db = (gain: number) => (20 * Math.log10(Math.max(gain, 1e-6))).toFixed(1);
  const num = (event: Event) => Number((event.currentTarget as HTMLInputElement).value);
  const field = 'w-full min-w-0 rounded-lg border border-line bg-surface px-2 py-1 text-sm';
</script>

<svelte:window onkeydown={keydown} />

<p class="sr-only" aria-live="polite">{announcement}</p>

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
            class="w-60 shrink-0 space-y-2 overflow-y-auto border-r border-line bg-raised p-3 text-sm"
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
                      class="inline-flex items-center gap-1 rounded-full border border-line transition-colors enabled:hover:border-accent enabled:hover:text-accent px-2 py-0.5 text-xs"
                      aria-label="Add {source.file.name} to the video track"
                      onclick={() => addFromBin(source, 'main')}><Plus size={11} /> Video</button
                    >
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-full border border-line transition-colors enabled:hover:border-accent enabled:hover:text-accent px-2 py-0.5 text-xs"
                      aria-label="Add {source.file.name} as an overlay"
                      onclick={() => addFromBin(source, 'overlay')}
                      ><Layers size={11} /> Overlay</button
                    >
                  {/if}
                  {#if kind === 'subtitle'}
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-full border border-line transition-colors enabled:hover:border-accent enabled:hover:text-accent px-2 py-0.5 text-xs"
                      aria-label="Add {source.file.name} as captions"
                      onclick={() => captionsPanel?.importFile(source.file)}
                      ><CaptionsIcon size={11} /> Captions</button
                    >
                  {:else if kind !== 'image'}
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-full border border-line transition-colors enabled:hover:border-accent enabled:hover:text-accent px-2 py-0.5 text-xs"
                      aria-label="Add {source.file.name} as music"
                      onclick={() => addFromBin(source, 'music')}><Music size={11} /> Music</button
                    >
                  {/if}
                </div>
              </div>
            {/each}
            <input
              bind:this={mediaPicker}
              type="file"
              multiple
              accept={MEDIA_ACCEPT}
              hidden
              onchange={(e) => {
                files.add([...(e.currentTarget.files ?? [])]);
                e.currentTarget.value = '';
              }}
            />
            <button
              type="button"
              class="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm transition-colors hover:border-accent hover:text-accent"
              onclick={() => mediaPicker?.click()}><Plus size={14} /> Add files</button
            >
          </aside>

          <section class="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <div class="relative mx-auto w-full">
              <div
                class="relative mx-auto bg-black"
                style:aspect-ratio={cropView
                  ? `${cropView.project.width} / ${cropView.project.height}`
                  : project
                    ? `${project.width} / ${project.height}`
                    : '16 / 9'}
                style:max-height="max(28dvh, calc(100dvh - 470px))"
              >
                <canvas
                  bind:this={canvas}
                  class="block size-full object-contain"
                  aria-label="Preview"
                ></canvas>
                {#if cropView}
                  <CropOverlay
                    rect={cropView.clip.transform.crop ?? { x: 0, y: 0, width: 1, height: 1 }}
                    aspect={null}
                    onChange={(rect, label) => setCrop(cropView.clip, rect, label)}
                  />
                {:else if project && drawingRedaction}
                  <RedactOverlay
                    redactions={[]}
                    selected={null}
                    onDraw={addRedaction}
                    onSelect={() => {}}
                  />
                {:else if project && selectedText}
                  <TransformBox
                    rect={selectedText.rect}
                    label="Text box"
                    onChange={(rect, action, factor) =>
                      apply(
                        `${action} text`,
                        updateText(project, selectedText.id, {
                          rect,
                          style: {
                            ...selectedText.style,
                            size: Math.max(0.005, selectedText.style.size * factor),
                          },
                        }),
                      )}
                  />
                {:else if project && selectedOverlay}
                  <TransformBox
                    rect={selectedOverlay.rect}
                    label="Overlay"
                    onChange={(rect, action) =>
                      apply(
                        `${action} overlay`,
                        updateOverlay(project, selectedOverlay.id, { rect }),
                      )}
                  />
                {:else if project && selectedRedaction}
                  <TransformBox
                    rect={selectedRedaction.rect}
                    label="Covered area"
                    onChange={(rect, action) =>
                      apply(
                        `${action} covered area`,
                        updateRedaction(project, selectedRedaction.id, { rect }),
                      )}
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
                class="icon-button border border-line disabled:opacity-40"
                aria-label="Play backwards"
                aria-pressed={reversing}
                onclick={playBackwards}><Play size={15} class="rotate-180" /></button
              >
              <button
                type="button"
                class="grid size-10 place-items-center rounded-full bg-accent text-on-accent transition-colors hover:bg-accent-hover"
                aria-label={playing || reversing ? 'Pause' : 'Play'}
                onclick={() => (playing || reversing ? halt() : play())}
              >
                {#if playing || reversing}<Pause size={18} />{:else}<Play size={18} />{/if}
              </button>
              <button
                type="button"
                class="icon-button border border-line disabled:opacity-40"
                aria-label="Stop"
                onclick={stop}><Square size={14} /></button
              >
              <span class="mx-1 h-6 w-px bg-line"></span>
              <button
                type="button"
                class="icon-button border border-line"
                aria-label="Previous frame"
                onclick={() => step(-1)}><ChevronLeft size={16} /></button
              >
              <button
                type="button"
                class="icon-button border border-line"
                aria-label="Next frame"
                onclick={() => step(1)}><ChevronRight size={16} /></button
              >
              <span class="font-mono text-sm tabular-nums">{time(position)} / {time(duration)}</span
              >
              <PlaybackVolume session={session.audio} />
              <span class="mx-1 h-6 w-px bg-line"></span>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border border-line transition-colors enabled:hover:border-accent enabled:hover:text-accent px-3 py-1.5 text-sm"
                title="Split at the playhead"
                onclick={split}><Scissors size={14} /> Split</button
              >
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border border-line transition-colors enabled:hover:border-accent enabled:hover:text-accent px-3 py-1.5 text-sm disabled:opacity-40"
                disabled={!selected}
                onclick={() =>
                  project &&
                  selected &&
                  (apply('Delete', removeAny(project, selected)), (selected = null))}
                ><Trash2 size={14} /> Delete</button
              >
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border border-line transition-colors enabled:hover:border-accent enabled:hover:text-accent px-3 py-1.5 text-sm disabled:opacity-40"
                disabled={!duplicable}
                onclick={duplicate}><Copy size={14} /> Duplicate</button
              >
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border border-line transition-colors enabled:hover:border-accent enabled:hover:text-accent px-3 py-1.5 text-sm"
                title="Add text at the playhead"
                onclick={insertText}><Type size={14} /> Text</button
              >
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm {drawingRedaction
                  ? 'border-accent text-accent'
                  : 'border-line hover:border-accent hover:text-accent'}"
                aria-pressed={drawingRedaction}
                onclick={() => (drawingRedaction = !drawingRedaction)}
                ><SquareDashed size={14} /> Redact an area</button
              >
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border border-line transition-colors enabled:hover:border-accent enabled:hover:text-accent px-3 py-1.5 text-sm"
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
                onMove={(id, start) => apply('Move', moveItem(project, id, start))}
                onResize={trim}
                onLane={(id, lane) => apply('Move', moveToLane(project, id, lane))}
                {soloView}
                {soloHear}
                onSoloView={(lane) => (soloView = soloView === lane ? null : lane)}
                onSoloHear={(lane) => (soloHear = soloHear === lane ? null : lane)}
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
                  <div class="space-y-1.5">
                    <p class="text-xs">
                      Crop
                      <span class="text-muted"
                        >· {selectedMain.transform.crop
                          ? `${Math.round(selectedMain.transform.crop.width * 100)}% × ${Math.round(selectedMain.transform.crop.height * 100)}%`
                          : 'none'}</span
                      >
                    </p>
                    <div class="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs {cropping ===
                        selectedMain.id
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-line hover:border-accent hover:text-accent'}"
                        aria-pressed={cropping === selectedMain.id}
                        onclick={() =>
                          (cropping = cropping === selectedMain.id ? null : selectedMain.id)}
                        ><CropIcon size={12} />
                        {cropping === selectedMain.id ? 'Done' : 'Crop on the preview'}</button
                      >
                      <button
                        type="button"
                        class="rounded-full border border-line transition-colors enabled:hover:border-accent enabled:hover:text-accent px-2.5 py-1 text-xs"
                        title="Crop to the project shape, so the clip fills the frame"
                        onclick={() => setCrop(selectedMain, fillCrop(selectedMain))}
                        >Fill the frame</button
                      >
                      <button
                        type="button"
                        class="rounded-full border border-line transition-colors enabled:hover:border-accent enabled:hover:text-accent px-2.5 py-1 text-xs disabled:opacity-40"
                        disabled={!selectedMain.transform.crop}
                        onclick={() => setCrop(selectedMain, null)}>Remove crop</button
                      >
                    </div>
                  </div>
                </section>
                <ChromaKeyFields
                  value={selectedMain.key}
                  onChange={(label, key) =>
                    apply(label, updateMain(project, selectedMain.id, { key }))}
                />
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
                  <label class="grid gap-1 text-xs">
                    <span class="flex justify-between"
                      >Volume <span class="text-muted">{db(selectedOverlay.volume)} dB</span></span
                    >
                    <input
                      type="range"
                      min="-30"
                      max="12"
                      step="0.5"
                      value={Number(db(selectedOverlay.volume))}
                      class="accent-accent"
                      oninput={(e) =>
                        apply(
                          'Volume',
                          updateOverlay(project, selectedOverlay.id, {
                            volume: 10 ** (num(e) / 20),
                          }),
                        )}
                    />
                  </label>
                  <label class="flex items-center gap-2 text-xs"
                    ><input
                      type="checkbox"
                      checked={selectedOverlay.muted}
                      onchange={(e) =>
                        apply(
                          'Mute',
                          updateOverlay(project, selectedOverlay.id, {
                            muted: (e.currentTarget as HTMLInputElement).checked,
                          }),
                        )}
                    /> Mute this overlay's sound</label
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
                </section>
                <ChromaKeyFields
                  value={selectedOverlay.key}
                  onChange={(label, key) =>
                    apply(label, updateOverlay(project, selectedOverlay.id, { key }))}
                />
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

              <section class="space-y-2">
                <h3 class="font-medium">Project</h3>
                <OverallVolume
                  gain={project.gain ?? 1}
                  onChange={(gain) => apply('Overall volume', { ...project, gain })}
                />
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
                    {#each [...new Set( [project.fps, 24, 25, 30, 50, 60] )].sort((a, b) => a - b) as f (f)}<option
                        value={f}>{f} fps</option
                      >{/each}
                  </select>
                </label>
              </section>

              <section class="space-y-2">
                <h3 class="font-medium">Export</h3>
                <select class={field} bind:value={exportFormat} aria-label="Export format">
                  <option value="mp4">MP4 (H.264)</option>
                  <option value="webm">WebM (VP9)</option>
                </select>
                {#if copyable}
                  <label class="flex items-start gap-2 text-xs"
                    ><input type="checkbox" class="mt-0.5" bind:checked={preferCopy} />
                    <span
                      >Fast export without re-encoding
                      <span class="block text-muted"
                        >No quality loss. Cuts move to the nearest key frame, and the original
                        format is kept.</span
                      ></span
                    ></label
                  >
                {/if}
                {#if !fastCopy}
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
                {/if}
                {#if exporting}
                  <p class="inline-flex items-center gap-2 text-muted">
                    <LoaderCircle size={14} class="animate-spin" />
                    {exporting.stage} · {Math.round((hub.latest.get(exporting.jobId) ?? 0) * 100)}%
                  </p>
                  <p class="text-xs text-muted">Keep this tab open until the export is ready.</p>
                {:else}
                  <button
                    type="button"
                    class="w-full rounded-full bg-accent px-4 py-2 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
                    disabled={duration <= 0}
                    onclick={runExport}>Export</button
                  >
                {/if}
                {#if !exporting}<label class="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      class="accent-accent"
                      checked={files.autoDownload}
                      onchange={(e) => files.setAutoDownload(e.currentTarget.checked)}
                    />
                    Download when it's done
                  </label>{/if}
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
