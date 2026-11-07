<script lang="ts">
  import { ChevronRight } from '@lucide/svelte';
  import { Collapsible } from 'bits-ui';
  import ColourField, { provideProjectColours } from '../app/ui/ColourField.svelte';
  import Field from '../app/ui/Field.svelte';
  import NumberField from '../app/ui/NumberField.svelte';
  import QualityPicker from '../app/ui/QualityPicker.svelte';
  import Segmented, { type SegmentedOption } from '../app/ui/Segmented.svelte';
  import Select, { type SelectOption } from '../app/ui/Select.svelte';
  import Slider from '../app/ui/Slider.svelte';
  import Switch from '../app/ui/Switch.svelte';
  import { inspectPool, scheduler } from '../engine';
  import { estimateBytes } from '../engine/av/plan';
  import { target } from '../engine/targets';
  import { changedKeys, describeChanges } from './describe';
  import { files, type FileItem } from './files.svelte';
  import type { ConvertOptions } from './options';
  import { avSettings } from './run';

  type Key = keyof ConvertOptions;
  type SizeChoice = number | 'original' | 'custom';

  const LOSSY = new Set([
    'jpeg',
    'webp',
    'avif',
    'jxl',
    'jp2',
    'webp-anim',
    'mp4',
    'webm',
    'mov',
    'mkv',
    'avi',
    'mpg',
    '3gp',
    'ogv',
    'mp3',
    'm4a',
    'm4r',
    'm4b',
    'opus',
    'ogg',
    'ac3',
  ]);
  const LOSSLESS_CAPABLE = new Set(['webp', 'avif', 'jxl', 'webp-anim']);
  const IMAGE_SIZES = { main: [1920, 1280, 800], other: [3840, 2560, 1024, 512, 256] };
  const VIDEO_HEIGHTS = { main: [1080, 720, 480], other: [2160, 1440, 360] };
  const QUICK_MB = [8, 10, 25, 50, 100];
  const FIT_OFF = 0;
  const FPS = [60, 30, 24, 15];
  const AUDIO_KBPS = [320, 256, 192, 160, 128, 96, 64];
  const SAMPLE_RATES = [48000, 44100, 32000, 22050];
  const CODECS = [
    { id: 'avc', label: 'H.264 (works everywhere)', probe: 'avc1.640028' },
    { id: 'hevc', label: 'HEVC (smaller, Apple devices)', probe: 'hvc1.1.6.L120.B0' },
    { id: 'vp9', label: 'VP9', probe: 'vp09.00.40.08' },
    { id: 'av1', label: 'AV1 (smallest, newer devices)', probe: 'av01.0.08M.08' },
  ];
  const DITHER: Record<string, string> = {
    floyd: 'Smooth (Floyd-Steinberg)',
    bayer: 'Patterned (Bayer)',
    none: 'None',
  };
  const PALETTE: Record<string, string> = {
    global: 'One palette for the clip',
    'per-frame': 'A palette per frame (sharper, larger)',
    diff: 'Smallest file',
    gifski: 'Best quality (gifski, slower)',
  };
  const METADATA: SelectOption<ConvertOptions['metadata']>[] = [
    { value: 'none', label: 'Remove all (location, camera, dates)' },
    { value: 'technical', label: 'Keep colour profile only' },
    { value: 'all', label: 'Keep everything' },
  ];
  // Select values are strings; this one stands for a null option.
  const UNSET = 'default';

  let encodable = $state<string[]>(['avc']);
  $effect(() => {
    const probes = Object.fromEntries(CODECS.map((codec) => [codec.id, codec.probe]));
    scheduler
      .submit({
        pool: inspectPool,
        memory: 8 * 1024 * 1024,
        run: (api) => api.encodableVideoCodecs(probes),
      })
      .result.then((ids) => (encodable = ids.length ? ids : ['avc']))
      .catch(() => {});
  });
  const codecIds = $derived([
    ...CODECS.filter((c) => encodable.includes(c.id)).map((c) => c.id),
    'prores',
  ]);

  let advancedOpen = $state(localStorage.getItem('advanced-open') === '1');
  $effect(() => localStorage.setItem('advanced-open', advancedOpen ? '1' : '0'));

  let { item }: { item: FileItem } = $props();
  const o = $derived(item.options);

  const context = $derived.by(() => {
    const targets = new Set<string>();
    let imageAlpha = false;
    let video = false;
    let hdr = false;
    let audio = false;
    let videoToAnimated = false;
    const id = files.targetOf(item);
    if (id) {
      targets.add(id);
      if (item.inspection?.metadata?.hdr && id === 'jpeg') hdr = true;
      const kind = item.inspection?.sniffed.kind;
      const group = target(id).group;
      if ((kind === 'audio' || kind === 'video') && group !== 'animated' && group !== 'image')
        audio = true;
      if (kind === 'video' && group === 'animated') videoToAnimated = true;
      if (kind === 'video') video = true;
      if (item.inspection?.alpha && !target(id).alpha) imageAlpha = true;
    }
    const groups = new Set([...targets].map((id) => target(id).group));
    return {
      targets,
      // GIFs from images go through libvips, whose GIF writer has a lossy mode; FFmpeg's has none.
      quality:
        [...targets].some((id) => LOSSY.has(id)) ||
        (item.inspection?.sniffed.kind === 'image' &&
          (targets.has('gif') || targets.has('gif-anim'))),
      imageSize:
        item.inspection?.sniffed.kind === 'image' &&
        (groups.has('image') || groups.has('animated')),
      videoSize: video && (groups.has('video') || groups.has('animated')),
      background:
        imageAlpha || [...targets].some((id) => !target(id).alpha && target(id).group === 'image'),
      removeAudio: video && groups.has('video'),
      lossless: [...targets].some((id) => LOSSLESS_CAPABLE.has(id)),
      gif: targets.has('gif') || targets.has('gif-anim'),
      cursor: targets.has('cur'),
      favicon: targets.has('favicon'),
      hdr,
      audio,
      videoToAnimated,
      av: video || audio,
      videoOut: video && [...targets].some((id) => target(id).group === 'video'),
    };
  });

  const advancedKeys = $derived<Key[]>([
    'metadata',
    ...(context.videoOut ? (['videoCodec', 'fps'] as const) : []),
    ...(context.audio ? (['audioKbps', 'sampleRate', 'channels'] as const) : []),
    ...(context.videoToAnimated
      ? (['gifFps', 'gifWidth', 'gifDither', 'gifPalette'] as const)
      : []),
    ...(context.lossless ? (['lossless'] as const) : []),
    ...(context.gif ? (['gifThreshold'] as const) : []),
    ...(context.cursor ? (['hotspotX', 'hotspotY'] as const) : []),
    ...(context.favicon ? (['maskableBackground'] as const) : []),
  ]);
  const advancedSummary = $derived(describeChanges(o, advancedKeys));

  const set = (patch: Partial<ConvertOptions>) => files.setOptions(patch);
  const changed = (keys: Key[]) => changedKeys(o, keys).length > 0;
  const reset = (keys: Key[]) => () => files.resetOptions(keys);
  provideProjectColours(() => [o.background, o.maskableBackground]);
  function estimate(quality: number): number | null {
    const id = files.targetOf(item);
    const probe = item.inspection?.av;
    if (!id || !probe || item.inspection?.sniffed.kind === 'image') return null;
    return estimateBytes(probe, avSettings(id, { ...o, quality, targetMb: null }));
  }

  let customSize = $state({ maxEdge: false, height: false });
  const fitChoice = $derived(
    o.targetMb === null ? FIT_OFF : QUICK_MB.includes(o.targetMb) ? o.targetMb : null,
  );
  const FIT_OPTIONS: SegmentedOption<number>[] = [
    { value: FIT_OFF, label: 'Off' },
    ...QUICK_MB.map((mb) => ({ value: mb, label: `${mb} MB` })),
  ];

  function sizeOptions(
    presets: readonly number[],
    name: (n: number) => string,
    tooltip: (n: number) => string,
  ): SegmentedOption<SizeChoice>[] {
    return [
      { value: 'original', label: 'Original' },
      ...presets.map((n) => ({ value: n, label: name(n), tooltip: tooltip(n) })),
      { value: 'custom', label: 'Custom' },
    ];
  }
</script>

{#snippet sizeField(
  label: string,
  key: 'maxEdge' | 'height',
  presets: { main: readonly number[]; other: readonly number[] },
  name: (n: number) => string,
  tooltip: (n: number) => string,
  fieldLabel: string,
)}
  {@const value = o[key]}
  {@const custom = customSize[key] || (value !== null && !presets.main.includes(value))}
  <Segmented
    {label}
    hideLabel
    options={sizeOptions(presets.main, name, tooltip)}
    value={custom ? 'custom' : (value ?? 'original')}
    onChange={(picked) => {
      customSize[key] = picked === 'custom';
      if (picked !== 'custom') set({ [key]: picked === 'original' ? null : picked });
    }}
  />
  {#if custom}
    <Segmented
      label="Other {label.toLowerCase()}s"
      hideLabel
      options={presets.other.map((n) => ({ value: n, label: name(n), tooltip: tooltip(n) }))}
      value={value !== null && presets.other.includes(value) ? value : null}
      onChange={(n) => set({ [key]: n })}
    />
    <NumberField
      label={fieldLabel}
      {value}
      min={16}
      unit="px"
      placeholder="Original"
      onChange={(n) => set({ [key]: n })}
      onClear={() => set({ [key]: null })}
    />
  {/if}
{/snippet}

{#snippet choice(
  key: Key,
  label: string,
  values: readonly (string | number)[],
  format: (value: string | number) => string,
  empty: string,
)}
  {@const current = o[key]}
  <Select
    {label}
    hideLabel
    options={[
      ...(empty ? [{ value: UNSET, label: empty }] : []),
      ...values.map((v) => ({ value: String(v), label: format(v) })),
    ]}
    value={current === null ? UNSET : String(current)}
    onChange={(raw) => {
      const value = raw === UNSET ? null : typeof values[0] === 'number' ? Number(raw) : raw;
      set({ [key]: value });
    }}
  />
{/snippet}

{#snippet advancedChoice(
  key: Key,
  label: string,
  values: readonly (string | number)[],
  format: (value: string | number) => string,
  empty = '',
)}
  <Field {label} changed={changed([key])} onReset={reset([key])}>
    {@render choice(key, label, values, format, empty)}
  </Field>
{/snippet}

<section class="grid gap-5 p-5" aria-labelledby="options-heading">
  <h2 id="options-heading" class="text-sm font-semibold">Options</h2>
  {#if context.quality}
    <QualityPicker quality={o.quality} {estimate} onChange={(quality) => set({ quality })} />
  {/if}
  {#if context.imageSize}
    <Field
      label="Image size"
      hint="Never enlarges."
      changed={changed(['maxEdge'])}
      onReset={reset(['maxEdge'])}
    >
      {@render sizeField(
        'Image size',
        'maxEdge',
        IMAGE_SIZES,
        String,
        (n) => `At most ${n} px`,
        'Longest side',
      )}
    </Field>
  {/if}
  {#if context.videoSize}
    <Field label="Video size" changed={changed(['height'])} onReset={reset(['height'])}>
      {@render sizeField(
        'Video size',
        'height',
        VIDEO_HEIGHTS,
        (h) => (h === 2160 ? '4K' : `${h}p`),
        (h) => `${h} px tall`,
        'Height',
      )}
    </Field>
  {/if}
  <Field
    label="Fit to file size"
    hint="The result is never larger than this without a warning."
    changed={changed(['targetMb'])}
    onReset={reset(['targetMb'])}
  >
    <div class="flex items-center gap-2">
      <div class="min-w-0 flex-1">
        <Segmented
          label="Fit to file size"
          hideLabel
          options={FIT_OPTIONS}
          value={fitChoice}
          onChange={(mb) => set({ targetMb: mb === FIT_OFF ? null : mb })}
        />
      </div>
      <div class="w-24 shrink-0">
        <NumberField
          label="Other file size"
          hideLabel
          value={fitChoice === null ? o.targetMb : null}
          min={0.01}
          decimals={2}
          unit="MB"
          placeholder="Other"
          onChange={(targetMb) => set({ targetMb })}
          onClear={() => set({ targetMb: null })}
        />
      </div>
    </div>
  </Field>
  {#if context.background}
    <Field
      label="Background for transparent areas"
      changed={changed(['background'])}
      onReset={reset(['background'])}
    >
      <ColourField
        label="Background colour"
        hideLabel
        value={o.background}
        onChange={(background) => set({ background })}
      />
    </Field>
  {/if}
  {#if context.removeAudio}
    <Field label="Audio" changed={changed(['removeAudio'])} onReset={reset(['removeAudio'])}>
      <Switch
        label="Remove the audio track"
        checked={o.removeAudio}
        onChange={(removeAudio) => set({ removeAudio })}
      />
    </Field>
  {/if}
  {#if context.hdr}
    <Field label="HDR" changed={changed(['keepHdr'])} onReset={reset(['keepHdr'])}>
      <Switch
        label="Keep HDR (JPG to JPG at the original size)"
        checked={o.keepHdr}
        onChange={(keepHdr) => set({ keepHdr })}
      />
    </Field>
  {/if}
  {#if context.av}
    <Field
      label="Trim"
      hint="Leave empty to keep the whole clip."
      changed={changed(['trimStart', 'trimEnd'])}
      onReset={reset(['trimStart', 'trimEnd'])}
    >
      <div class="grid grid-cols-2 gap-2">
        <NumberField
          label="From"
          value={o.trimStart}
          min={0}
          time
          placeholder="Start"
          onChange={(trimStart) => set({ trimStart })}
          onClear={() => set({ trimStart: null })}
        />
        <NumberField
          label="To"
          value={o.trimEnd}
          min={0}
          time
          placeholder="End"
          onChange={(trimEnd) => set({ trimEnd })}
          onClear={() => set({ trimEnd: null })}
        />
      </div>
    </Field>
  {/if}

  <Collapsible.Root bind:open={advancedOpen}>
    <Collapsible.Trigger class="flex items-center gap-2 text-sm text-muted hover:text-fg">
      <ChevronRight size={14} class="transition-transform {advancedOpen ? 'rotate-90' : ''}" />
      Advanced
      {#if !advancedOpen && advancedSummary.length}<span class="truncate"
          >· {advancedSummary.join(' · ')}</span
        >{/if}
    </Collapsible.Trigger>
    <Collapsible.Content class="mt-4 grid gap-5">
      <Field label="Metadata" changed={changed(['metadata'])} onReset={reset(['metadata'])}>
        <Select
          label="Metadata"
          hideLabel
          options={METADATA}
          value={o.metadata}
          onChange={(metadata) => set({ metadata })}
        />
      </Field>
      {#if context.lossless}
        <Field label="Compression" changed={changed(['lossless'])} onReset={reset(['lossless'])}>
          <Switch
            label="Lossless (WebP, AVIF, JPEG XL)"
            checked={o.lossless}
            onChange={(lossless) => set({ lossless })}
          />
        </Field>
      {/if}
      {#if context.videoOut}
        {@render advancedChoice(
          'videoCodec',
          'Video codec',
          codecIds,
          (v) => CODECS.find((c) => c.id === v)?.label ?? 'ProRes 4444 (MOV, keeps transparency)',
          'Automatic',
        )}
        {@render advancedChoice('fps', 'Frame rate', FPS, (v) => `${v} fps`, 'Original')}
      {/if}
      {#if context.audio}
        {@render advancedChoice(
          'audioKbps',
          'Audio bitrate',
          AUDIO_KBPS,
          (v) => `${v} kbps`,
          'Automatic',
        )}
        {@render advancedChoice(
          'sampleRate',
          'Sample rate',
          SAMPLE_RATES,
          (v) => `${Number(v) / 1000} kHz`,
          'Original',
        )}
        {@render advancedChoice(
          'channels',
          'Channels',
          [2, 1],
          (v) => (v === 1 ? 'Mono' : 'Stereo'),
          'Original',
        )}
      {/if}
      {#if context.videoToAnimated}
        {@render advancedChoice(
          'gifFps',
          'Animation frame rate',
          [30, 25, 20, 15, 12, 10, 8, 5],
          (v) => `${v} fps`,
        )}
        {@render advancedChoice(
          'gifWidth',
          'Animation width',
          [1280, 960, 720, 640, 480, 360, 320, 240],
          (v) => `${v} px wide`,
        )}
        {@render advancedChoice(
          'gifDither',
          'Dithering',
          ['floyd', 'bayer', 'none'],
          (v) => DITHER[String(v)] ?? String(v),
        )}
        {@render advancedChoice(
          'gifPalette',
          'Palette',
          ['global', 'per-frame', 'diff', 'gifski'],
          (v) => PALETTE[String(v)] ?? String(v),
        )}
      {/if}
      {#if context.gif}
        <Slider
          label="GIF transparency cut-off"
          value={o.gifThreshold}
          min={1}
          max={254}
          defaultValue={128}
          hint="Pixels more transparent than this become fully transparent."
          onChange={(gifThreshold) => set({ gifThreshold })}
        />
      {/if}
      {#if context.cursor}
        <Field
          label="Cursor hotspot (32 px)"
          changed={changed(['hotspotX', 'hotspotY'])}
          onReset={reset(['hotspotX', 'hotspotY'])}
        >
          <div class="grid grid-cols-2 gap-2">
            <NumberField
              label="X"
              value={o.hotspotX}
              min={0}
              max={31}
              unit="px"
              onChange={(hotspotX) => set({ hotspotX })}
            />
            <NumberField
              label="Y"
              value={o.hotspotY}
              min={0}
              max={31}
              unit="px"
              onChange={(hotspotY) => set({ hotspotY })}
            />
          </div>
        </Field>
      {/if}
      {#if context.favicon}
        <Field
          label="App icon background"
          hint="Used for the Apple touch icon and the maskable icon."
          changed={changed(['maskableBackground'])}
          onReset={reset(['maskableBackground'])}
        >
          <ColourField
            label="Icon background colour"
            hideLabel
            value={o.maskableBackground}
            onChange={(maskableBackground) => set({ maskableBackground })}
          />
        </Field>
      {/if}
    </Collapsible.Content>
  </Collapsible.Root>
</section>
