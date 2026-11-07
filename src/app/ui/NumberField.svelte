<script lang="ts">
  import { tick } from 'svelte';
  import { clamp, decimalsOf, formatTime, formatValue, parseNumber, parseTime } from './number';

  let {
    label,
    hideLabel = false,
    value,
    min,
    max,
    step,
    unit = '',
    time = false,
    decimals,
    placeholder,
    disabled = false,
    onChange,
    onClear,
  }: {
    label: string;
    hideLabel?: boolean;
    value: number | null;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    time?: boolean; // seconds, shown as m:ss.ff
    decimals?: number;
    placeholder?: string;
    disabled?: boolean;
    onChange: (value: number) => void;
    onClear?: () => void;
  } = $props();

  const id = $props.id();
  const increment = $derived(step ?? (time ? 0.1 : 1));
  const places = $derived(decimals ?? (time ? 2 : decimalsOf(increment)));
  const text = $derived(
    value === null ? '' : time ? formatTime(value) : formatValue(value, places).replace('−', '-'),
  );

  async function refresh(input: HTMLInputElement) {
    await tick();
    input.value = text;
  }

  function set(next: number) {
    const bounded = Number(clamp(next, min, max).toFixed(places));
    if (bounded !== value) onChange(bounded);
  }

  function commit(input: HTMLInputElement) {
    const raw = input.value.trim();
    if (!raw && onClear) {
      if (value !== null) onClear();
    } else {
      const parsed = time ? parseTime(raw) : parseNumber(raw, unit);
      if (parsed !== null) set(parsed);
    }
    void refresh(input);
  }

  function keydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const start = value ?? min ?? 0;
    set(start + (event.key === 'ArrowUp' ? increment : -increment));
    void refresh(event.currentTarget);
  }
</script>

<div class="grid min-w-0 gap-1">
  {#if !hideLabel}<label for={id} class="text-xs text-muted">{label}</label>{/if}
  <div class="relative">
    <input
      {id}
      type="text"
      inputmode="decimal"
      role="spinbutton"
      autocomplete="off"
      aria-label={hideLabel ? label : undefined}
      aria-valuenow={value ?? undefined}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={text || undefined}
      class="h-8 w-full min-w-0 rounded-lg border border-line bg-surface px-2 text-sm tabular-nums disabled:opacity-40 {unit &&
      !time
        ? 'pr-8'
        : ''}"
      value={text}
      {placeholder}
      {disabled}
      onchange={(e) => commit(e.currentTarget)}
      onkeydown={keydown}
    />
    {#if unit && !time}
      <span
        class="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted"
        aria-hidden="true">{unit}</span
      >
    {/if}
  </div>
</div>
