<script lang="ts">
  import ColourField from '../../app/ui/ColourField.svelte';
  import SectionToggle from '../../app/ui/SectionToggle.svelte';
  import Slider from '../../app/ui/Slider.svelte';
  import { DEFAULT_KEY, type ChromaKey } from '../../project/video';

  let {
    value,
    picking,
    onPick,
    onChange,
  }: {
    value: ChromaKey | null;
    picking: boolean;
    onPick: (picking: boolean) => void;
    onChange: (label: string, key: ChromaKey | null) => void;
  } = $props();

  const PRESETS = [
    ['Green', '#00ff00'],
    ['Blue', '#0047bb'],
  ] as const;

  let lastOn = $state<ChromaKey | null>(null);
  $effect.pre(() => {
    if (value) lastOn = value;
  });

  const set = (label: string, patch: Partial<ChromaKey>) =>
    value && onChange(label, { ...value, ...patch });
</script>

{#snippet percent(
  label: string,
  undoLabel: string,
  key: 'similarity' | 'smoothness' | 'spill',
  current: ChromaKey,
)}
  <Slider
    {label}
    value={current[key] * 100}
    min={0}
    max={100}
    defaultValue={DEFAULT_KEY[key] * 100}
    unit="%"
    onChange={(v) => set(undoLabel, { [key]: v / 100 })}
  />
{/snippet}

<section aria-label="Chroma key">
  <SectionToggle
    label="Remove a colour"
    checked={value !== null}
    onChange={(on) => onChange('Chroma key', on ? { ...(lastOn ?? DEFAULT_KEY) } : null)}
  >
    {#if value}
      <p class="text-xs text-muted">
        Makes one colour transparent, so whatever is on the layers below shows through.
      </p>
      <div class="flex flex-wrap items-center gap-1.5 text-xs">
        {#each PRESETS as [label, color] (label)}
          <button
            type="button"
            class="rounded-full border px-2.5 py-1 {value.color === color
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-line hover:border-accent hover:text-accent'}"
            aria-pressed={value.color === color}
            onclick={() => set('Key colour', { color })}>{label}</button
          >
        {/each}
      </div>
      <ColourField
        label="Key colour"
        value={value.color}
        {picking}
        {onPick}
        onChange={(color) => set('Key colour', { color })}
      />
      {@render percent('Tolerance', 'Key tolerance', 'similarity', value)}
      {@render percent('Edge softness', 'Key softness', 'smoothness', value)}
      {@render percent('Spill removal', 'Key spill', 'spill', value)}
    {/if}
  </SectionToggle>
</section>
