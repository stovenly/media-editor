<script lang="ts" module>
  import { createContext } from 'svelte';

  // Each editor provides the colours its project already uses; ColourField offers up to 8 of them.
  const [getUsed, setUsed, hasUsed] = createContext<() => readonly string[]>();
  export const provideProjectColours = setUsed;
</script>

<script lang="ts">
  import { Pipette } from '@lucide/svelte';
  import { Popover, Slider } from 'bits-ui';
  import { tick, untrack } from 'svelte';
  import { alphaOf, hsvHex, hsvOf, parseHex, withAlpha, type Hsv } from './colour';
  import { clamp } from './number';

  let {
    label,
    hideLabel = false,
    value,
    alpha = false,
    disabled = false,
    picking = false,
    onPick,
    onChange,
  }: {
    label: string;
    hideLabel?: boolean;
    value: string; // #rrggbb, or #rrggbbaa with `alpha`
    alpha?: boolean;
    disabled?: boolean;
    picking?: boolean;
    onPick?: (picking: boolean) => void;
    onChange: (value: string) => void;
  } = $props();

  const id = $props.id();
  const used = hasUsed() ? getUsed() : () => [];

  const PRESETS = [
    ['White', '#ffffff'],
    ['Black', '#000000'],
    ['Indigo', '#4f46e5'],
    ['Red', '#ff0000'],
    ['Yellow', '#ffff00'],
    ['Green', '#00ff00'],
    ['Blue', '#0000ff'],
  ] as const;

  const rgb = $derived(parseHex(value.slice(0, 7)) ?? '#000000');
  const opacity = $derived(alpha ? alphaOf(value) : 1);
  const projectColours = $derived.by(() => {
    const seen = new Set<string>(PRESETS.map(([, hex]) => hex));
    const out: string[] = [];
    for (const colour of used()) {
      const hex = parseHex(colour.slice(0, 7));
      if (!hex || seen.has(hex)) continue;
      seen.add(hex);
      out.push(hex);
      if (out.length === 8) break;
    }
    return out;
  });

  // Kept apart from `value` so hue and saturation survive a trip through black or grey.
  let hsv = $state<Hsv>(untrack(() => hsvOf(rgb)));
  $effect.pre(() => {
    const current = rgb;
    if (untrack(() => hsvHex(hsv)) !== current) hsv = hsvOf(current);
  });

  function emit(hex: string, a = opacity) {
    const next = alpha ? withAlpha(hex, a) : hex;
    if (next !== value) onChange(next);
  }

  function update(next: Hsv) {
    hsv = next;
    emit(hsvHex(next));
  }

  let square = $state<HTMLDivElement>();

  function pointSquare(event: PointerEvent) {
    const box = square!.getBoundingClientRect();
    update({
      ...hsv,
      s: clamp((event.clientX - box.left) / box.width, 0, 1),
      v: 1 - clamp((event.clientY - box.top) / box.height, 0, 1),
    });
  }

  async function typed(input: HTMLInputElement) {
    const parsed = parseHex(input.value, alpha);
    if (parsed) emit(parsed.slice(0, 7), parsed.length === 9 ? alphaOf(parsed) : opacity);
    await tick();
    input.value = rgb;
  }

  const field = $derived(
    `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h} 100% 50%)`,
  );
  const checker = 'repeating-conic-gradient(#c8c8c8 0 25%, #fff 0 50%) 0 0 / 8px 8px';
</script>

{#snippet swatch(name: string, hex: string)}
  <button
    type="button"
    class="size-6 rounded-md border border-line {rgb === hex
      ? 'ring-2 ring-accent ring-offset-1 ring-offset-raised'
      : ''}"
    style:background-color={hex}
    aria-label={name}
    title={name}
    onclick={() => emit(hex)}
  ></button>
{/snippet}

{#snippet strip(name: string, current: number, max: number, set: (v: number) => void, bg: string)}
  <Slider.Root
    type="single"
    bind:value={() => current, set}
    min={0}
    {max}
    step={1}
    thumbPositioning="exact"
    class="relative flex h-4 w-full touch-none items-center select-none"
  >
    <span class="absolute inset-x-0 h-3 rounded-full border border-line" style:background={bg}
    ></span>
    <Slider.Thumb
      index={0}
      aria-label={name}
      class="block size-4 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
    />
  </Slider.Root>
{/snippet}

<div class="grid gap-0.5">
  <div class="flex min-h-5 items-center {hideLabel ? 'sr-only' : ''}">
    <span id="{id}-label" class="text-xs text-muted">{label}</span>
  </div>
  <div class="flex items-center gap-1.5">
    <Popover.Root>
      <Popover.Trigger
        {disabled}
        aria-labelledby="{id}-label {id}-value"
        class="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-line bg-surface pr-2.5 pl-1.5 text-sm transition-colors enabled:hover:border-accent disabled:opacity-40 data-[state=open]:border-accent"
      >
        <span class="size-5 overflow-hidden rounded border border-line" style:background={checker}>
          <span class="block size-full" style:background-color={rgb} style:opacity></span>
        </span>
        <span id="{id}-value" class="font-mono text-xs text-muted"
          >{rgb}{alpha ? ` ${Math.round(opacity * 100)}%` : ''}</span
        >
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={4}
          align="start"
          aria-label={label}
          class="z-[60] grid w-60 gap-2.5 rounded-lg border border-line bg-raised p-2.5 shadow-lg outline-none"
        >
          <div class="flex flex-wrap gap-1.5">
            {#each PRESETS as [name, hex] (hex)}{@render swatch(name, hex)}{/each}
          </div>
          {#if projectColours.length}
            <div class="grid gap-1">
              <span class="text-xs text-muted">In this project</span>
              <div class="flex flex-wrap gap-1.5">
                {#each projectColours as hex (hex)}{@render swatch(hex, hex)}{/each}
              </div>
            </div>
          {/if}
          <div
            bind:this={square}
            role="presentation"
            class="relative h-32 cursor-crosshair touch-none rounded-md"
            style:background={field}
            onpointerdown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              pointSquare(e);
            }}
            onpointermove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && pointSquare(e)}
          >
            <span
              class="pointer-events-none absolute size-3 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
              style:left="{hsv.s * 100}%"
              style:bottom="{hsv.v * 100}%"
            ></span>
          </div>
          {@render strip(
            'Hue',
            Math.round(hsv.h),
            360,
            (h) => update({ ...hsv, h }),
            'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
          )}
          {#if alpha}
            {@render strip(
              'Opacity',
              Math.round(opacity * 100),
              100,
              (a) => emit(rgb, a / 100),
              `linear-gradient(to right, transparent, ${rgb}), ${checker}`,
            )}
          {/if}
          <div class="flex items-center gap-2">
            <input
              type="text"
              spellcheck="false"
              class="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 font-mono text-sm"
              aria-label="{label} hex"
              value={rgb}
              onchange={(e) => typed(e.currentTarget)}
            />
            {#if alpha}
              <span class="w-10 shrink-0 text-right text-sm text-muted tabular-nums"
                >{Math.round(opacity * 100)}%</span
              >
            {/if}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
    {#if onPick}
      <button
        type="button"
        class="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors disabled:opacity-40 {picking
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-line text-muted enabled:hover:text-fg'}"
        aria-pressed={picking}
        {disabled}
        onclick={() => onPick(!picking)}><Pipette size={13} /> Pick from video</button
      >
    {/if}
  </div>
  {#if picking}<p class="text-xs text-muted">Click the preview to take the colour there.</p>{/if}
</div>
