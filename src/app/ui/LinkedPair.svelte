<script lang="ts">
  import { Link2, Link2Off } from '@lucide/svelte';
  import IconToggle from './IconToggle.svelte';
  import NumberField from './NumberField.svelte';
  import { clamp, decimalsOf } from './number';

  let {
    label,
    labels,
    values,
    ratio,
    linked,
    linkLabel = 'Keep proportions',
    min,
    max,
    step = 1,
    unit = '',
    disabled = false,
    onChange,
    onLinkedChange,
  }: {
    label: string;
    labels: readonly [string, string];
    values: readonly [number, number];
    ratio?: number; // first ÷ second while linked; defaults to the current values' ratio
    linked: boolean;
    linkLabel?: string;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    disabled?: boolean;
    onChange: (values: [number, number]) => void;
    onLinkedChange: (linked: boolean) => void;
  } = $props();

  const places = $derived(decimalsOf(step));
  const fit = (v: number) => Number(clamp(v, min, max).toFixed(places));

  function set(index: 0 | 1, value: number) {
    if (!linked) {
      onChange(index === 0 ? [value, values[1]] : [values[0], value]);
      return;
    }
    const r = ratio ?? (values[1] ? values[0] / values[1] : 1);
    onChange(index === 0 ? [value, fit(value / r)] : [fit(value * r), value]);
  }
</script>

<div class="flex items-end gap-2" role="group" aria-label={label}>
  <div class="min-w-0 flex-1">
    <NumberField
      label={labels[0]}
      value={values[0]}
      {min}
      {max}
      {step}
      {unit}
      {disabled}
      onChange={(v) => set(0, v)}
    />
  </div>
  <IconToggle
    label={linkLabel}
    pressed={linked}
    icon={Link2Off}
    pressedIcon={Link2}
    {disabled}
    onChange={onLinkedChange}
  />
  <div class="min-w-0 flex-1">
    <NumberField
      label={labels[1]}
      value={values[1]}
      {min}
      {max}
      {step}
      {unit}
      {disabled}
      onChange={(v) => set(1, v)}
    />
  </div>
</div>
