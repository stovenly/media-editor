<script lang="ts">
  let {
    gain,
    disabled = false,
    onChange,
  }: { gain: number; disabled?: boolean; onChange: (gain: number) => void } = $props();

  const db = $derived(20 * Math.log10(Math.max(gain, 1e-6)));
</script>

<label class="grid gap-1 text-xs">
  <span class="flex justify-between"
    >Overall volume <span class="text-muted tabular-nums"
      >{db > 0.05 ? '+' : ''}{db.toFixed(1)} dB</span
    ></span
  >
  <input
    type="range"
    min="-24"
    max="12"
    step="0.5"
    value={Math.round(db * 2) / 2}
    {disabled}
    class="accent-accent disabled:opacity-40"
    oninput={(e) => onChange(10 ** (Number(e.currentTarget.value) / 20))}
  />
  {#if disabled}<span class="text-muted">Normalise sets the level while it's on.</span>{/if}
</label>
