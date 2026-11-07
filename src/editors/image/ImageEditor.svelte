<script lang="ts">
  import {
    Crop,
    Droplets,
    FlipHorizontal2,
    FlipVertical2,
    Grid3x3,
    Link2,
    Link2Off,
    LoaderCircle,
    Redo2,
    RotateCcw,
    RotateCw,
    Scaling,
    SlidersHorizontal,
    Square,
    SquareDashed,
    Trash2,
    Undo2,
  } from '@lucide/svelte';
  import { Dialog } from 'bits-ui';
  import ColourField, { provideProjectColours } from '../../app/ui/ColourField.svelte';
  import IconToggle from '../../app/ui/IconToggle.svelte';
  import LinkedPair from '../../app/ui/LinkedPair.svelte';
  import NumberField from '../../app/ui/NumberField.svelte';
  import Segmented, { type SegmentedOption } from '../../app/ui/Segmented.svelte';
  import Slider from '../../app/ui/Slider.svelte';
  import { files, type FileItem } from '../../converter/files.svelte';
  import { History } from '../../project/history.svelte';
  import {
    aspectCrop,
    croppedSize,
    EMPTY_EDIT,
    finalSize,
    inscribedSize,
    isEmptyEdit,
    NO_ADJUSTMENTS,
    orientedSize,
    type Adjustments,
    type ImageEdit,
    type Rect,
    type Redaction,
  } from '../../project/image-edit';
  import { saveProject } from '../../project/save';
  import ProjectMenu from '../../project/ProjectMenu.svelte';
  import CropOverlay from './CropOverlay.svelte';
  import RedactOverlay from './RedactOverlay.svelte';
  import { EditorSession } from './session.svelte';
  import Stage from './Stage.svelte';

  let { item, onClose }: { item: FileItem; onClose: () => void } = $props();

  type Tab = 'crop' | 'adjust' | 'redact' | 'size';
  const TABS: { id: Tab; label: string; icon: typeof Crop }[] = [
    { id: 'crop', label: 'Crop & rotate', icon: Crop },
    { id: 'adjust', label: 'Adjust', icon: SlidersHorizontal },
    { id: 'redact', label: 'Redact', icon: SquareDashed },
    { id: 'size', label: 'Size', icon: Scaling },
  ];
  const ASPECTS: { label: string; value: number | 'original' | null }[] = [
    { label: 'Free', value: null },
    { label: 'Original', value: 'original' },
    { label: '1:1', value: 1 },
    { label: '4:3', value: 4 / 3 },
    { label: '3:2', value: 3 / 2 },
    { label: '16:9', value: 16 / 9 },
    { label: '4:5', value: 4 / 5 },
    { label: '9:16', value: 9 / 16 },
  ];
  const SLIDERS: {
    key: keyof Adjustments;
    label: string;
    min: number;
    max: number;
    step: number;
  }[] = [
    { key: 'exposure', label: 'Exposure', min: -3, max: 3, step: 0.05 },
    { key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1 },
    { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1 },
    { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1 },
    { key: 'temperature', label: 'Temperature', min: -100, max: 100, step: 1 },
    { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1 },
  ];
  const REDACTION_KINDS: SegmentedOption<Redaction['kind']>[] = [
    { value: 'fill', label: 'Box', icon: Square, tooltip: 'Solid box (redact)' },
    { value: 'blur', label: 'Blur', icon: Droplets, tooltip: 'Blur (cosmetic)' },
    { value: 'pixelate', label: 'Pixelate', icon: Grid3x3, tooltip: 'Pixelate (cosmetic)' },
  ];
  const SIDES = [
    ['top', 'Top'],
    ['right', 'Right'],
    ['bottom', 'Bottom'],
    ['left', 'Left'],
  ] as const;

  // svelte-ignore state_referenced_locally
  const session = new EditorSession(item.file, item.inspection!);
  // svelte-ignore state_referenced_locally
  const history = new History<ImageEdit>(item.edit ?? EMPTY_EDIT);
  const edit = $derived(history.state);

  let tab = $state<Tab>('crop');
  let compare = $state(false);
  let aspectChoice = $state<number | 'original' | null>(null);
  let selected = $state<string | null>(null);
  let redactKind = $state<Redaction['kind']>('fill');
  let redactColor = $state('#000000');
  provideProjectColours(() => [
    redactColor,
    ...edit.redactions.map((r) => r.color),
    ...(edit.pad ? [edit.pad.color] : []),
  ]);
  let lockRatio = $state(true);
  const evenPad = (pad: ImageEdit['pad']) =>
    !pad || (pad.top === pad.right && pad.top === pad.bottom && pad.top === pad.left);
  // svelte-ignore state_referenced_locally
  let padLinked = $state(evenPad(edit.pad));
  let applyToAll = $state(false);

  const images = $derived(
    files.items.filter((i) => i.inspection?.sniffed.kind === 'image' && i.inspection.pages <= 1),
  );

  $effect(() => {
    session.render(edit, compare ? 'original' : tab === 'crop' ? 'geometry' : 'full');
  });
  $effect(() => () => session.close());

  const source = $derived(session.size);
  const rotated = $derived(
    source ? inscribedSize(orientedSize(source, edit.rotate), edit.angle) : null,
  );
  const cropped = $derived(source ? croppedSize(source, edit) : null);
  const output = $derived(source ? finalSize(source, edit) : null);
  const crop = $derived(edit.crop ?? { x: 0, y: 0, width: 1, height: 1 });
  const pixelAspect = $derived.by((): number | null => {
    if (aspectChoice !== 'original') return aspectChoice;
    if (!source) return null;
    const oriented = orientedSize(source, edit.rotate);
    return oriented.width / oriented.height;
  });
  const fractionAspect = $derived(
    pixelAspect && rotated ? pixelAspect / (rotated.width / rotated.height) : null,
  );

  const set = (label: string, patch: Partial<ImageEdit>) =>
    history.apply(label, { ...edit, ...patch });

  function setCrop(rect: Rect, label = 'Crop') {
    const full =
      rect.x <= 0.0005 && rect.y <= 0.0005 && rect.width >= 0.999 && rect.height >= 0.999;
    set(label, { crop: full ? null : rect });
  }

  function chooseAspect(value: number | 'original' | null) {
    aspectChoice = value;
    if (value === null || !rotated || !source) return;
    const target =
      value === 'original'
        ? orientedSize(source, edit.rotate).width / orientedSize(source, edit.rotate).height
        : value;
    setCrop(aspectCrop(rotated, target), 'Crop to a ratio');
  }

  function rotateBy(delta: 90 | -90) {
    const next = (((edit.rotate + delta) % 360) + 360) % 360;
    set('Rotate', { rotate: next as ImageEdit['rotate'], crop: null });
  }

  function setCropPixels(field: 'x' | 'y' | 'width' | 'height', value: number) {
    if (!rotated) return;
    const scale = field === 'x' || field === 'width' ? rotated.width : rotated.height;
    setCrop({ ...crop, [field]: Math.max(0, value) / scale }, 'Crop');
  }

  function addRedaction(rect: Rect) {
    const redaction: Redaction = {
      id: crypto.randomUUID(),
      rect,
      kind: redactKind,
      color: redactColor,
    };
    set('Cover an area', { redactions: [...edit.redactions, redaction] });
    selected = redaction.id;
  }

  function removeRedaction(id: string) {
    set('Remove covered area', { redactions: edit.redactions.filter((r) => r.id !== id) });
    selected = null;
  }

  function setResize(w: number, h: number) {
    if (!cropped) return;
    set('Resize', {
      resize:
        w === cropped.width && h === cropped.height
          ? null
          : { width: Math.max(1, w), height: Math.max(1, h) },
    });
  }

  function resizeToPercent(percent: number) {
    if (!cropped) return;
    const w = Math.round((cropped.width * percent) / 100);
    const h = lockRatio
      ? Math.round((w * cropped.height) / cropped.width)
      : (edit.resize?.height ?? cropped.height);
    setResize(w, h);
  }

  function linkPad(linked: boolean) {
    padLinked = linked;
    if (linked && !evenPad(edit.pad)) setPad('all', edit.pad!.top);
  }

  function setPad(side: 'top' | 'right' | 'bottom' | 'left' | 'all', value: number) {
    const current = edit.pad ?? { top: 0, right: 0, bottom: 0, left: 0, color: '#ffffff' };
    const px = Math.max(0, Math.round(value));
    const next =
      side === 'all'
        ? { ...current, top: px, right: px, bottom: px, left: px }
        : { ...current, [side]: px };
    const empty = !next.top && !next.right && !next.bottom && !next.left;
    set('Add a border', { pad: empty ? null : next });
  }

  function done() {
    if (applyToAll) files.applyEditToAll(edit);
    else files.setEdit(item.id, edit);
    onClose();
  }

  let projectMenu = $state<ReturnType<typeof ProjectMenu>>();
  let stage = $state<ReturnType<typeof Stage>>();
  let zoom = $state<number | null>(null);

  function save(bundle: boolean) {
    return saveProject(item.file.name, { kind: 'image', edit }, [item], { bundle });
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
    } else if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      selected &&
      tab === 'redact'
    ) {
      removeRedaction(selected);
    }
  }
</script>

<svelte:window onkeydown={keydown} />

<Dialog.Root open onOpenChange={(open) => !open && onClose()}>
  <Dialog.Portal>
    <Dialog.Content class="fixed inset-0 z-50 flex flex-col bg-surface outline-none">
      <header class="flex flex-wrap items-center gap-2 border-b border-line bg-raised px-4 py-2.5">
        <Dialog.Title class="min-w-0 flex-1 truncate font-semibold">
          Edit {item.file.name}
          {#if output}<span class="ml-2 text-sm font-normal text-muted tabular-nums"
              >{output.width}×{output.height}</span
            >{/if}
        </Dialog.Title>
        <Dialog.Description class="sr-only"
          >Crop, rotate, adjust and redact the image. Changes apply when you convert.</Dialog.Description
        >
        {#if session.busy}<LoaderCircle size={16} class="animate-spin text-muted" />{/if}
        <button
          type="button"
          class="icon-button"
          aria-label="Undo {history.undoLabel ?? ''}"
          title="Undo (Ctrl+Z)"
          disabled={!history.canUndo}
          onclick={() => history.undo()}><Undo2 size={16} /></button
        >
        <button
          type="button"
          class="icon-button"
          aria-label="Redo {history.redoLabel ?? ''}"
          title="Redo (Ctrl+Shift+Z)"
          disabled={!history.canRedo}
          onclick={() => history.redo()}><Redo2 size={16} /></button
        >
        <button
          type="button"
          class="rounded-full border px-3 py-1.5 text-sm {compare
            ? 'border-accent text-accent'
            : 'border-line hover:border-accent hover:text-accent'}"
          aria-pressed={compare}
          onpointerdown={() => (compare = true)}
          onpointerup={() => (compare = false)}
          onpointerleave={() => (compare = false)}
          onkeydown={(e) => e.key === ' ' && (compare = true)}
          onkeyup={(e) => e.key === ' ' && (compare = false)}
        >
          Hold to compare
        </button>
        <button
          type="button"
          class="rounded-full px-3 py-1.5 text-sm text-muted hover:text-fg disabled:opacity-40"
          disabled={isEmptyEdit(edit)}
          onclick={() => history.apply('Reset', EMPTY_EDIT)}>Reset</button
        >
        <ProjectMenu bind:this={projectMenu} onSave={save} />
        <Dialog.Close class="rounded-full px-3 py-1.5 text-sm text-muted hover:text-fg"
          >Cancel</Dialog.Close
        >
        <button
          type="button"
          class="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
          onclick={done}>Done</button
        >
      </header>

      <div class="flex min-h-0 flex-1">
        <div class="flex min-h-0 min-w-0 flex-1 p-6">
          {#if session.error}
            <p class="m-auto max-w-md text-center text-danger">{session.error}</p>
          {:else if !session.bitmap}
            <p class="m-auto inline-flex items-center gap-2 text-muted">
              <LoaderCircle size={16} class="animate-spin" /> Opening image…
            </p>
          {:else}
            <Stage
              bind:this={stage}
              bind:zoom
              bitmap={session.bitmap}
              scale={session.size?.scale ?? 1}
              detail={session.detail}
              onDetail={(region, width, height, key) =>
                session.requestDetail(
                  edit,
                  compare ? 'original' : tab === 'crop' ? 'geometry' : 'full',
                  region,
                  width,
                  height,
                  key,
                )}
            >
              {#snippet overlay()}
                {#if !compare && tab === 'crop'}
                  <CropOverlay
                    rect={crop}
                    aspect={fractionAspect}
                    onChange={(rect, label) => setCrop(rect, label)}
                  />
                {:else if !compare && tab === 'redact'}
                  <RedactOverlay
                    redactions={edit.redactions}
                    {selected}
                    onDraw={addRedaction}
                    onSelect={(id) => (selected = id)}
                  />
                {/if}
              {/snippet}
            </Stage>
          {/if}
        </div>

        <aside class="flex w-80 shrink-0 flex-col border-l border-line bg-raised">
          <div class="flex border-b border-line" role="tablist">
            {#each TABS as t (t.id)}
              <button
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                class="flex flex-1 flex-col items-center gap-1 px-2 py-2.5 text-xs {tab === t.id
                  ? 'text-accent'
                  : 'text-muted hover:text-fg'}"
                onclick={() => (tab = t.id)}
              >
                <t.icon size={17} />
                {t.label}
              </button>
            {/each}
          </div>

          <div class="flex-1 space-y-5 overflow-y-auto p-4 text-sm">
            {#if tab === 'crop'}
              <section class="space-y-2">
                <h3 class="font-medium">Aspect ratio</h3>
                <div class="flex flex-wrap gap-1.5">
                  {#each ASPECTS as a (a.label)}
                    <button
                      type="button"
                      class="rounded-full border px-3 py-1 {aspectChoice === a.value
                        ? 'border-accent text-accent'
                        : 'border-line hover:border-accent hover:text-accent'}"
                      onclick={() => chooseAspect(a.value)}>{a.label}</button
                    >
                  {/each}
                </div>
              </section>
              {#if rotated}
                <section class="grid grid-cols-2 gap-2">
                  {#each [['x', 'Left', rotated.width], ['y', 'Top', rotated.height], ['width', 'Width', rotated.width], ['height', 'Height', rotated.height]] as const as [field, label, scale] (field)}
                    <NumberField
                      {label}
                      value={Math.round(crop[field] * scale)}
                      min={0}
                      unit="px"
                      onChange={(v) => setCropPixels(field, v)}
                    />
                  {/each}
                </section>
              {/if}
              <section class="space-y-2">
                <h3 class="font-medium">Rotate and flip</h3>
                <div class="flex gap-1.5">
                  <button
                    type="button"
                    class="icon-button border border-line"
                    aria-label="Rotate left"
                    onclick={() => rotateBy(-90)}><RotateCcw size={16} /></button
                  >
                  <button
                    type="button"
                    class="icon-button border border-line"
                    aria-label="Rotate right"
                    onclick={() => rotateBy(90)}><RotateCw size={16} /></button
                  >
                  <button
                    type="button"
                    class="icon-button border border-line {edit.flipH ? 'text-accent' : ''}"
                    aria-label="Flip horizontally"
                    aria-pressed={edit.flipH}
                    onclick={() => set('Flip', { flipH: !edit.flipH })}
                    ><FlipHorizontal2 size={16} /></button
                  >
                  <button
                    type="button"
                    class="icon-button border border-line {edit.flipV ? 'text-accent' : ''}"
                    aria-label="Flip vertically"
                    aria-pressed={edit.flipV}
                    onclick={() => set('Flip', { flipV: !edit.flipV })}
                    ><FlipVertical2 size={16} /></button
                  >
                </div>
                <Slider
                  label="Straighten"
                  value={edit.angle}
                  min={-45}
                  max={45}
                  step={0.1}
                  defaultValue={0}
                  unit="°"
                  signed
                  onChange={(angle) => set('Straighten', { angle, crop: null })}
                />
              </section>
            {:else if tab === 'adjust'}
              {#each SLIDERS as s (s.key)}
                <Slider
                  label={s.label}
                  value={edit.adjust[s.key]}
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  defaultValue={0}
                  signed
                  onChange={(v) => set(s.label, { adjust: { ...edit.adjust, [s.key]: v } })}
                />
              {/each}
              <button
                type="button"
                class="text-xs text-muted hover:text-accent"
                onclick={() => set('Reset adjustments', { adjust: NO_ADJUSTMENTS })}
                >Reset adjustments</button
              >
            {:else if tab === 'redact'}
              <p class="text-muted">Drag over the picture to cover an area.</p>
              <Segmented
                label="Cover with"
                options={REDACTION_KINDS}
                value={redactKind}
                onChange={(kind) => (redactKind = kind)}
              />
              {#if redactKind === 'fill'}
                <ColourField
                  label="Box colour"
                  value={redactColor}
                  onChange={(c) => (redactColor = c)}
                />
              {:else}
                <p class="rounded-xl bg-sunken px-3 py-2 text-xs text-warning">
                  Blur and pixelation are cosmetic. They can be partly reversed, so don't use them
                  to hide text, faces or numbers that must stay secret.
                </p>
              {/if}
              <p class="text-xs text-muted">
                Redacting also removes all metadata and embedded thumbnails from the converted file.
              </p>
              {#if edit.redactions.length}
                <ul class="space-y-1">
                  {#each edit.redactions as r, index (r.id)}
                    <li
                      class="flex items-center gap-2 rounded-lg px-2 py-1 {r.id === selected
                        ? 'bg-accent-soft'
                        : ''}"
                    >
                      <button
                        type="button"
                        class="flex-1 text-left"
                        onclick={() => (selected = r.id)}
                      >
                        {index + 1}. {r.kind === 'fill'
                          ? 'Solid box'
                          : r.kind === 'blur'
                            ? 'Blur'
                            : 'Pixelate'}
                      </button>
                      <button
                        type="button"
                        class="icon-button size-7"
                        aria-label="Remove area {index + 1}"
                        onclick={() => removeRedaction(r.id)}><Trash2 size={14} /></button
                      >
                    </li>
                  {/each}
                </ul>
              {/if}
            {:else if tab === 'size' && cropped}
              <section class="space-y-2">
                <h3 class="font-medium">Resize</h3>
                <LinkedPair
                  label="Resize"
                  labels={['Width', 'Height']}
                  values={[
                    edit.resize?.width ?? cropped.width,
                    edit.resize?.height ?? cropped.height,
                  ]}
                  ratio={cropped.width / cropped.height}
                  linked={lockRatio}
                  min={1}
                  unit="px"
                  onChange={([w, h]) => setResize(w, h)}
                  onLinkedChange={(linked) => (lockRatio = linked)}
                />
                <div class="flex flex-wrap gap-1.5">
                  {#each [25, 50, 75, 100] as percent (percent)}
                    <button
                      type="button"
                      class="rounded-full border border-line transition-colors enabled:hover:border-accent enabled:hover:text-accent px-3 py-1 text-xs"
                      onclick={() => resizeToPercent(percent)}>{percent}%</button
                    >
                  {/each}
                </div>
              </section>
              <section class="space-y-2">
                <h3 class="font-medium">Border</h3>
                <div class="flex items-end gap-2">
                  <div class="grid min-w-0 flex-1 grid-cols-2 gap-2">
                    {#if padLinked}
                      <NumberField
                        label="All sides"
                        value={edit.pad?.top ?? 0}
                        min={0}
                        unit="px"
                        onChange={(v) => setPad('all', v)}
                      />
                    {:else}
                      {#each SIDES as [side, label] (side)}
                        <NumberField
                          {label}
                          value={edit.pad?.[side] ?? 0}
                          min={0}
                          unit="px"
                          onChange={(v) => setPad(side, v)}
                        />
                      {/each}
                    {/if}
                  </div>
                  <IconToggle
                    label="Same on every side"
                    pressed={padLinked}
                    icon={Link2Off}
                    pressedIcon={Link2}
                    onChange={linkPad}
                  />
                </div>
                <ColourField
                  label="Border colour"
                  value={edit.pad?.color ?? '#ffffff'}
                  disabled={!edit.pad}
                  onChange={(color) =>
                    edit.pad && set('Border colour', { pad: { ...edit.pad, color } })}
                />
              </section>
            {/if}
          </div>

          {#if images.length > 1}
            <label class="flex items-center gap-2 border-t border-line px-4 py-3 text-sm">
              <input type="checkbox" bind:checked={applyToAll} /> Apply these edits to all {images.length}
              images
            </label>
          {/if}
        </aside>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
