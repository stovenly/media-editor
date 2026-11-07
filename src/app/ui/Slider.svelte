<script lang="ts">
  import { tick } from 'svelte';
  import { Slider } from 'bits-ui';
  import ResetButton from './ResetButton.svelte';
  import { clamp, decimalsOf, formatValue, parseNumber, snapToStep } from './number';

  let {
    label,
    value,
    min,
    max,
    step = 1,
    defaultValue,
    unit = '',
    decimals,
    signed = false,
    format,
    marks = [],
    compact = false,
    disabled = false,
    hint,
    onChange,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    defaultValue?: number;
    unit?: string;
    decimals?: number;
    signed?: boolean;
    format?: (value: number) => string;
    marks?: readonly { value: number; label: string }[];
    compact?: boolean;
    disabled?: boolean;
    hint?: string;
    onChange: (value: number) => void;
  } = $props();

  const id = $props.id();
  const places = $derived(decimals ?? decimalsOf(step));
  const text = $derived(format ? format(value) : formatValue(value, places, unit, signed));
  const changed = $derived(
    defaultValue !== undefined && Math.abs(value - defaultValue) >= 0.5 * 10 ** -places,
  );
  const percent = (v: number) => ((clamp(v, min, max) - min) / (max - min)) * 100;
  const showDefault = $derived(
    defaultValue !== undefined && defaultValue > min && defaultValue < max,
  );

  function reset() {
    if (defaultValue !== undefined && changed && !disabled) onChange(defaultValue);
  }

  // bits-ui writes back any off-step value it's given, which would record a spurious undo step.
  const snapped = $derived(snapToStep(value, min, max, step));

  function drag(next: number) {
    if (next !== snapped) onChange(next);
  }

  function set(next: number) {
    if (next !== value) onChange(next);
  }

  async function typed(input: HTMLInputElement) {
    const parsed = parseNumber(input.value, unit);
    if (parsed !== null) set(clamp(parsed, min, max));
    await tick();
    input.value = text;
  }
</script>

{#snippet track(width: string)}
  <Slider.Root
    type="single"
    bind:value={() => snapped, drag}
    {min}
    {max}
    {step}
    {disabled}
    thumbPositioning="exact"
    ondblclick={reset}
    class="relative flex h-8 {width} touch-none items-center select-none data-disabled:opacity-40"
  >
    <span class="relative h-1 w-full overflow-hidden rounded-full bg-sunken">
      <Slider.Range class="h-full bg-accent" />
    </span>
    {#if showDefault}
      <span
        class="pointer-events-none absolute top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-muted"
        style:left="{percent(defaultValue!)}%"
        aria-hidden="true"
      ></span>
    {/if}
    {#each marks as mark (mark.value)}
      <span
        class="pointer-events-none absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted"
        style:left="{percent(mark.value)}%"
        aria-hidden="true"
      ></span>
    {/each}
    <Slider.Thumb
      index={0}
      aria-label={label}
      aria-valuetext={text}
      class="block size-4 rounded-full border-2 border-accent bg-raised shadow-sm transition-transform data-active:scale-110"
    />
  </Slider.Root>
{/snippet}

{#if compact}
  <div class="inline-flex items-center gap-2 text-xs text-muted">
    <span>{label}</span>
    <div class="px-2">{@render track('w-28')}</div>
  </div>
{:else}
  <div class="grid gap-0.5">
    <div class="flex min-h-5 items-center gap-2">
      <span id="{id}-label" class="text-xs text-muted" ondblclick={reset} role="presentation"
        >{label}</span
      >
      {#if changed && !disabled}<ResetButton {label} onclick={reset} />{/if}
    </div>
    <div class="flex items-start gap-2">
      <div class="min-w-0 flex-1 px-2">
        {@render track('w-full')}
        {#if marks.length}
          <div class="relative h-4" aria-hidden="true">
            {#each marks as mark (mark.value)}
              <span
                class="absolute top-0 -translate-x-1/2 text-[10px] leading-none text-muted"
                style:left="{percent(mark.value)}%">{mark.label}</span
              >
            {/each}
          </div>
        {/if}
      </div>
      <input
        type="text"
        inputmode="decimal"
        class="h-8 w-20 shrink-0 rounded-lg border border-line bg-surface px-2 text-right text-sm tabular-nums disabled:opacity-40"
        aria-label="{label} value"
        aria-describedby={hint ? `${id}-hint` : undefined}
        value={text}
        {disabled}
        onchange={(e) => typed(e.currentTarget)}
      />
    </div>
    {#if hint}<p id="{id}-hint" class="text-xs text-muted">{hint}</p>{/if}
  </div>
{/if}
