<script lang="ts" module>
  // Points on the 1..100 quality scale; 100 is the source-matched bitrate for video.
  export const QUALITY_PRESETS = { original: 100, balanced: 70, small: 40 } as const;
</script>

<script lang="ts">
  import { formatBytes } from '../format';
  import NumberField from './NumberField.svelte';
  import Segmented, { type SegmentedOption } from './Segmented.svelte';
  import Slider from './Slider.svelte';

  type Mode = keyof typeof QUALITY_PRESETS | 'custom';

  let {
    label = 'Quality',
    quality,
    targetMb = null,
    estimate,
    disabled = false,
    onChange,
    onTargetMb,
  }: {
    label?: string;
    quality: number; // 1..100
    targetMb?: number | null; // decimal megabytes
    estimate?: (quality: number) => number | null; // bytes
    disabled?: boolean;
    onChange: (quality: number) => void;
    onTargetMb?: (mb: number | null) => void;
  } = $props();

  const OPTIONS: SegmentedOption<Mode>[] = [
    { value: 'original', label: 'Original quality' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'small', label: 'Small' },
    { value: 'custom', label: 'Custom' },
  ];

  let chosenCustom = $state(false);
  const fitting = $derived(Boolean(onTargetMb && targetMb));
  const mode = $derived<Mode>(
    chosenCustom || fitting
      ? 'custom'
      : ((Object.keys(QUALITY_PRESETS) as (keyof typeof QUALITY_PRESETS)[]).find(
          (key) => QUALITY_PRESETS[key] === quality,
        ) ?? 'custom'),
  );

  const sizeOf = (q: number) => {
    const bytes = estimate?.(q);
    return bytes ? `~${formatBytes(bytes)}` : null;
  };
  const customSize = $derived(fitting ? targetMb! * 1_000_000 : (estimate?.(quality) ?? null));

  function pick(next: Mode) {
    chosenCustom = next === 'custom';
    if (next === 'custom') return;
    if (fitting) onTargetMb?.(null);
    if (QUALITY_PRESETS[next] !== quality) onChange(QUALITY_PRESETS[next]);
  }
</script>

{#snippet option(o: SegmentedOption<Mode>)}
  {@const size = o.value === 'custom' ? null : sizeOf(QUALITY_PRESETS[o.value])}
  <span class="flex min-w-0 flex-col items-center leading-tight">
    <span class="text-center">{o.label}</span>
    {#if size}<span class="text-[10px] text-muted tabular-nums">{size}</span>{/if}
  </span>
{/snippet}

<div class="grid gap-3">
  <Segmented {label} options={OPTIONS} value={mode} {disabled} onChange={pick} {option} />
  {#if mode === 'custom'}
    <Slider label="Quality level" value={quality} min={1} max={100} {disabled} {onChange} />
    {#if onTargetMb}
      <NumberField
        label="Fit to file size"
        value={targetMb}
        min={0.1}
        step={1}
        decimals={2}
        unit="MB"
        placeholder="Off"
        {disabled}
        onChange={onTargetMb}
        onClear={() => onTargetMb(null)}
      />
    {/if}
    {#if customSize}<p class="text-xs text-muted">About {formatBytes(customSize)}</p>{/if}
  {/if}
</div>
