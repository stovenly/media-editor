<script lang="ts">
  import { ChevronRight, RotateCcw } from '@lucide/svelte';
  import { Collapsible } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { inspectPool, scheduler } from '../engine';
  import { target } from '../engine/targets';
  import { changedKeys, describeChanges } from './describe';
  import { files } from './files.svelte';
  import type { ConvertOptions } from './options';

  type Key = keyof ConvertOptions;

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
  const IMAGE_SIZES = [3840, 2560, 1920, 1280, 1024, 800, 512, 256];
  const VIDEO_HEIGHTS = [2160, 1440, 1080, 720, 480, 360];
  const QUICK_MB = [8, 10, 25, 50, 100];
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

  let open = $state(localStorage.getItem('options-open') === '1');
  let advancedOpen = $state(localStorage.getItem('advanced-open') === '1');
  $effect(() => localStorage.setItem('options-open', open ? '1' : '0'));
  $effect(() => localStorage.setItem('advanced-open', advancedOpen ? '1' : '0'));

  const o = $derived(files.options);

  const context = $derived.by(() => {
    const targets = new Set<string>();
    let imageAlpha = false;
    let video = false;
    let hdr = false;
    let audio = false;
    let videoToAnimated = false;
    for (const item of files.items) {
      const id = files.targetOf(item);
      if (!id) continue;
      targets.add(id);
      if (item.inspection?.metadata?.hdr && id === 'jpeg') hdr = true;
      const kind = item.inspection?.sniffed.kind;
      const group = target(id).group;
      if ((kind === 'audio' || kind === 'video') && group !== 'animated' && group !== 'image')
        audio = true;
      if (kind === 'video' && group === 'animated') videoToAnimated = true;
      if (item.inspection?.sniffed.kind === 'video') video = true;
      if (item.inspection?.alpha && !target(id).alpha) imageAlpha = true;
    }
    const groups = new Set([...targets].map((id) => target(id).group));
    return {
      targets,
      quality: [...targets].some((id) => LOSSY.has(id)),
      imageSize: [...files.items].some(
        (item) =>
          item.inspection?.sniffed.kind === 'image' &&
          (groups.has('image') || groups.has('animated')),
      ),
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

  const mainKeys = $derived<Key[]>([
    ...(context.quality ? (['quality'] as const) : []),
    ...(context.imageSize ? (['maxEdge'] as const) : []),
    ...(context.videoSize ? (['height'] as const) : []),
    'targetMb',
    ...(context.background ? (['background'] as const) : []),
    ...(context.removeAudio ? (['removeAudio'] as const) : []),
    ...(context.hdr ? (['keepHdr'] as const) : []),
    ...(context.av ? (['trimStart', 'trimEnd'] as const) : []),
  ]);
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
  const summary = $derived(describeChanges(o, [...mainKeys, ...advancedKeys]));
  const advancedSummary = $derived(describeChanges(o, advancedKeys));

  const set = (patch: Partial<ConvertOptions>) => files.setOptions(patch);
  const numberOrNull = (value: string) => (value === '' ? null : Number(value));

  let customMb = $state('');
</script>

{#snippet field(label: string, keys: Key[], control: Snippet, hint?: string)}
  <div class="grid gap-1.5">
    <div class="flex items-center gap-2">
      <span class="text-sm font-medium">{label}</span>
      {#if changedKeys(o, keys).length}
        <button
          type="button"
          class="inline-flex items-center gap-1 text-xs text-muted hover:text-accent"
          aria-label="Reset {label.toLowerCase()}"
          onclick={() => files.resetOptions(keys)}
        >
          <RotateCcw size={12} /> Reset
        </button>
      {/if}
    </div>
    {@render control()}
    {#if hint}<p class="text-xs text-muted">{hint}</p>{/if}
  </div>
{/snippet}

{#snippet quality()}
  <div class="flex items-center gap-3 text-xs text-muted">
    <span class="w-16">Smaller file</span>
    <input
      type="range"
      min="1"
      max="100"
      value={o.quality}
      aria-label="Quality"
      class="flex-1 accent-accent"
      onchange={(e) => set({ quality: Number(e.currentTarget.value) })}
    />
    <span class="w-16 text-right">Better quality</span>
  </div>
{/snippet}

{#snippet imageSize()}
  <select
    class="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
    aria-label="Image size"
    value={o.maxEdge ?? ''}
    onchange={(e) => set({ maxEdge: numberOrNull(e.currentTarget.value) })}
  >
    <option value="">Original size</option>
    {#each IMAGE_SIZES as size (size)}
      <option value={size}>At most {size} px</option>
    {/each}
  </select>
{/snippet}

{#snippet videoSize()}
  <select
    class="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
    aria-label="Video size"
    value={o.height ?? ''}
    onchange={(e) => set({ height: numberOrNull(e.currentTarget.value) })}
  >
    <option value="">Original size</option>
    {#each VIDEO_HEIGHTS as h (h)}
      <option value={h}>{h === 2160 ? '4K' : `${h}p`}</option>
    {/each}
  </select>
{/snippet}

{#snippet fit()}
  <div class="flex flex-wrap items-center gap-1.5">
    <button
      type="button"
      class="rounded-full border px-3 py-1 text-sm {o.targetMb === null
        ? 'border-accent text-accent'
        : 'border-line'}"
      onclick={() => set({ targetMb: null })}>Off</button
    >
    {#each QUICK_MB as mb (mb)}
      <button
        type="button"
        class="rounded-full border px-3 py-1 text-sm {o.targetMb === mb
          ? 'border-accent text-accent'
          : 'border-line'}"
        onclick={() => set({ targetMb: mb })}>{mb} MB</button
      >
    {/each}
    <label class="inline-flex items-center gap-1.5 text-sm">
      <input
        type="number"
        min="0.01"
        step="any"
        placeholder="Custom"
        class="w-24 rounded-full border border-line bg-surface px-3 py-1 text-sm"
        bind:value={customMb}
        onchange={() => {
          const mb = Number(customMb);
          if (mb > 0) set({ targetMb: mb });
        }}
      />
      MB
    </label>
  </div>
{/snippet}

{#snippet colour(key: 'background' | 'maskableBackground', label: string)}
  <label class="inline-flex items-center gap-2 text-sm">
    <input
      type="color"
      value={o[key]}
      aria-label={label}
      class="size-8 cursor-pointer rounded-lg border border-line bg-surface"
      onchange={(e) => set({ [key]: e.currentTarget.value })}
    />
    <span class="font-mono text-xs text-muted">{o[key]}</span>
  </label>
{/snippet}

{#snippet background()}{@render colour('background', 'Background colour')}{/snippet}
{#snippet maskable()}{@render colour('maskableBackground', 'Icon background colour')}{/snippet}

{#snippet removeAudio()}
  <label class="inline-flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={o.removeAudio}
      onchange={(e) => set({ removeAudio: e.currentTarget.checked })}
    />
    Remove the audio track
  </label>
{/snippet}

{#snippet choice(
  key: Key,
  label: string,
  values: readonly (string | number)[],
  format: (value: string | number) => string,
  empty: string,
)}
  <select
    class="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
    aria-label={label}
    value={o[key] ?? ''}
    onchange={(e) => {
      const raw = e.currentTarget.value;
      const value = raw === '' ? null : typeof values[0] === 'number' ? Number(raw) : raw;
      set({ [key]: value });
    }}
  >
    {#if empty}<option value="">{empty}</option>{/if}
    {#each values as value (value)}
      <option {value}>{format(value)}</option>
    {/each}
  </select>
{/snippet}

{#snippet trim()}
  <div class="flex items-center gap-2 text-sm">
    <input
      type="number"
      min="0"
      step="0.1"
      placeholder="Start"
      aria-label="Start, in seconds"
      class="w-24 rounded-lg border border-line bg-surface px-2 py-1"
      value={o.trimStart ?? ''}
      onchange={(e) => set({ trimStart: numberOrNull(e.currentTarget.value) })}
    />
    to
    <input
      type="number"
      min="0"
      step="0.1"
      placeholder="End"
      aria-label="End, in seconds"
      class="w-24 rounded-lg border border-line bg-surface px-2 py-1"
      value={o.trimEnd ?? ''}
      onchange={(e) => set({ trimEnd: numberOrNull(e.currentTarget.value) })}
    />
    seconds
  </div>
{/snippet}

{#snippet codec()}{@render choice(
    'videoCodec',
    'Video codec',
    codecIds,
    (v) => CODECS.find((c) => c.id === v)?.label ?? 'ProRes 4444 (MOV, keeps transparency)',
    'Automatic',
  )}{/snippet}
{#snippet fps()}{@render choice('fps', 'Frame rate', FPS, (v) => `${v} fps`, 'Original')}{/snippet}
{#snippet audioKbps()}{@render choice(
    'audioKbps',
    'Audio bitrate',
    AUDIO_KBPS,
    (v) => `${v} kbps`,
    'Automatic',
  )}{/snippet}
{#snippet sampleRate()}{@render choice(
    'sampleRate',
    'Sample rate',
    SAMPLE_RATES,
    (v) => `${Number(v) / 1000} kHz`,
    'Original',
  )}{/snippet}
{#snippet channels()}{@render choice(
    'channels',
    'Channels',
    [2, 1],
    (v) => (v === 1 ? 'Mono' : 'Stereo'),
    'Original',
  )}{/snippet}
{#snippet gifFps()}{@render choice(
    'gifFps',
    'Animation frame rate',
    [30, 25, 20, 15, 12, 10, 8, 5],
    (v) => `${v} fps`,
    '',
  )}{/snippet}
{#snippet gifWidth()}{@render choice(
    'gifWidth',
    'Animation width',
    [1280, 960, 720, 640, 480, 360, 320, 240],
    (v) => `${v} px wide`,
    '',
  )}{/snippet}
{#snippet gifDither()}{@render choice(
    'gifDither',
    'Dithering',
    ['floyd', 'bayer', 'none'],
    (v) => DITHER[String(v)] ?? String(v),
    '',
  )}{/snippet}
{#snippet gifPalette()}{@render choice(
    'gifPalette',
    'Palette',
    ['global', 'per-frame', 'diff', 'gifski'],
    (v) => PALETTE[String(v)] ?? String(v),
    '',
  )}{/snippet}

{#snippet keepHdr()}
  <label class="inline-flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={o.keepHdr}
      onchange={(e) => set({ keepHdr: e.currentTarget.checked })}
    />
    Keep HDR (JPG to JPG at the original size)
  </label>
{/snippet}

{#snippet metadata()}
  <select
    class="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
    aria-label="Metadata"
    value={o.metadata}
    onchange={(e) => set({ metadata: e.currentTarget.value as ConvertOptions['metadata'] })}
  >
    <option value="none">Remove all (location, camera, dates)</option>
    <option value="technical">Keep colour profile only</option>
    <option value="all">Keep everything</option>
  </select>
{/snippet}

{#snippet lossless()}
  <label class="inline-flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={o.lossless}
      onchange={(e) => set({ lossless: e.currentTarget.checked })}
    />
    Lossless (WebP, AVIF, JPEG XL)
  </label>
{/snippet}

{#snippet gifThreshold()}
  <input
    type="range"
    min="1"
    max="254"
    value={o.gifThreshold}
    aria-label="GIF transparency threshold"
    class="w-full accent-accent"
    onchange={(e) => set({ gifThreshold: Number(e.currentTarget.value) })}
  />
{/snippet}

{#snippet hotspot()}
  <div class="flex items-center gap-3 text-sm">
    <label class="inline-flex items-center gap-1.5"
      >X <input
        type="number"
        min="0"
        max="31"
        value={o.hotspotX}
        class="w-16 rounded-lg border border-line bg-surface px-2 py-1"
        onchange={(e) => set({ hotspotX: Number(e.currentTarget.value) })}
      /></label
    >
    <label class="inline-flex items-center gap-1.5"
      >Y <input
        type="number"
        min="0"
        max="31"
        value={o.hotspotY}
        class="w-16 rounded-lg border border-line bg-surface px-2 py-1"
        onchange={(e) => set({ hotspotY: Number(e.currentTarget.value) })}
      /></label
    >
  </div>
{/snippet}

<Collapsible.Root bind:open class="rounded-2xl border border-line bg-raised shadow-xs">
  <Collapsible.Trigger class="flex w-full items-center gap-2 px-4 py-3 text-left text-sm">
    <ChevronRight size={16} class="text-muted transition-transform {open ? 'rotate-90' : ''}" />
    <span class="font-medium">Options</span>
    {#if !open && summary.length}
      <span class="truncate text-muted">· {summary.join(' · ')}</span>
    {/if}
  </Collapsible.Trigger>
  <Collapsible.Content class="grid gap-5 border-t border-line px-4 py-4 sm:grid-cols-2">
    {#if context.quality}{@render field('Quality', ['quality'], quality)}{/if}
    {#if context.imageSize}{@render field(
        'Image size',
        ['maxEdge'],
        imageSize,
        'Never enlarges.',
      )}{/if}
    {#if context.videoSize}{@render field('Video size', ['height'], videoSize)}{/if}
    {@render field(
      'Fit to file size',
      ['targetMb'],
      fit,
      'The result is never larger than this without a warning.',
    )}
    {#if context.background}{@render field(
        'Background for transparent areas',
        ['background'],
        background,
      )}{/if}
    {#if context.removeAudio}{@render field('Audio', ['removeAudio'], removeAudio)}{/if}
    {#if context.hdr}{@render field('HDR', ['keepHdr'], keepHdr)}{/if}
    {#if context.av}{@render field(
        'Trim',
        ['trimStart', 'trimEnd'],
        trim,
        'Leave empty to keep the whole clip.',
      )}{/if}

    <Collapsible.Root bind:open={advancedOpen} class="sm:col-span-2">
      <Collapsible.Trigger class="flex items-center gap-2 text-sm text-muted hover:text-fg">
        <ChevronRight size={14} class="transition-transform {advancedOpen ? 'rotate-90' : ''}" />
        Advanced
        {#if !advancedOpen && advancedSummary.length}<span class="truncate"
            >· {advancedSummary.join(' · ')}</span
          >{/if}
      </Collapsible.Trigger>
      <Collapsible.Content class="mt-4 grid gap-5 sm:grid-cols-2">
        {@render field('Metadata', ['metadata'], metadata)}
        {#if context.lossless}{@render field('Compression', ['lossless'], lossless)}{/if}
        {#if context.videoOut}
          {@render field('Video codec', ['videoCodec'], codec)}
          {@render field('Frame rate', ['fps'], fps)}
        {/if}
        {#if context.audio}
          {@render field('Audio bitrate', ['audioKbps'], audioKbps)}
          {@render field('Sample rate', ['sampleRate'], sampleRate)}
          {@render field('Channels', ['channels'], channels)}
        {/if}
        {#if context.videoToAnimated}
          {@render field('Animation frame rate', ['gifFps'], gifFps)}
          {@render field('Animation width', ['gifWidth'], gifWidth)}
          {@render field('Dithering', ['gifDither'], gifDither)}
          {@render field('Palette', ['gifPalette'], gifPalette)}
        {/if}
        {#if context.gif}{@render field(
            'GIF transparency cut-off',
            ['gifThreshold'],
            gifThreshold,
            'Pixels more transparent than this become fully transparent.',
          )}{/if}
        {#if context.cursor}{@render field(
            'Cursor hotspot (32 px)',
            ['hotspotX', 'hotspotY'],
            hotspot,
          )}{/if}
        {#if context.favicon}{@render field(
            'App icon background',
            ['maskableBackground'],
            maskable,
            'Used for the Apple touch icon and the maskable icon.',
          )}{/if}
      </Collapsible.Content>
    </Collapsible.Root>
  </Collapsible.Content>
</Collapsible.Root>
