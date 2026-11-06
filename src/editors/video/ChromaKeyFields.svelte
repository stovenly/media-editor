<script lang="ts">
  import { Pipette } from '@lucide/svelte';
  import { DEFAULT_KEY, type ChromaKey } from '../../project/video';

  let {
    value,
    onChange,
  }: { value: ChromaKey | null; onChange: (label: string, key: ChromaKey | null) => void } =
    $props();

  type EyeDropperResult = { sRGBHex: string };
  type EyeDropperApi = new () => { open(): Promise<EyeDropperResult> };
  const EyeDropper = (globalThis as { EyeDropper?: EyeDropperApi }).EyeDropper;

  const PRESETS = [
    ['Green', '#00ff00'],
    ['Blue', '#0047bb'],
  ] as const;

  const set = (label: string, patch: Partial<ChromaKey>) =>
    value && onChange(label, { ...value, ...patch });
  const num = (event: Event) => Number((event.currentTarget as HTMLInputElement).value);

  async function pick() {
    try {
      const { sRGBHex } = await new EyeDropper!().open();
      set('Key colour', { color: sRGBHex });
    } catch {
      // Esc closes the eyedropper without a colour.
    }
  }
</script>

<section class="space-y-2" aria-label="Chroma key">
  <label class="flex items-center gap-2 font-medium">
    <input
      type="checkbox"
      class="accent-accent"
      checked={value !== null}
      onchange={(e) => onChange('Chroma key', e.currentTarget.checked ? { ...DEFAULT_KEY } : null)}
    />
    Chroma key
  </label>
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
      <input
        type="color"
        class="size-7 rounded border border-line"
        aria-label="Key colour"
        value={value.color}
        onchange={(e) => set('Key colour', { color: e.currentTarget.value })}
      />
      {#if EyeDropper}
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 hover:border-accent hover:text-accent"
          onclick={pick}><Pipette size={12} /> Pick from the screen</button
        >
      {/if}
    </div>
    <label class="grid gap-1 text-xs"
      >Tolerance<input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value.similarity}
        class="accent-accent"
        oninput={(e) => set('Key tolerance', { similarity: num(e) })}
      /></label
    >
    <label class="grid gap-1 text-xs"
      >Edge softness<input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value.smoothness}
        class="accent-accent"
        oninput={(e) => set('Key softness', { smoothness: num(e) })}
      /></label
    >
    <label class="grid gap-1 text-xs"
      >Spill removal<input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value.spill}
        class="accent-accent"
        oninput={(e) => set('Key spill', { spill: num(e) })}
      /></label
    >
  {/if}
</section>
