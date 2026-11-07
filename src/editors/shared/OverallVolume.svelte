<script lang="ts">
  import Slider from '../../app/ui/Slider.svelte';

  let {
    gain,
    disabled = false,
    onChange,
  }: { gain: number; disabled?: boolean; onChange: (gain: number) => void } = $props();
</script>

<Slider
  label="Overall volume"
  value={20 * Math.log10(Math.max(gain, 1e-6))}
  min={-24}
  max={12}
  step={0.5}
  decimals={1}
  defaultValue={0}
  unit="dB"
  signed
  {disabled}
  hint={disabled ? "Normalise sets the level while it's on." : undefined}
  onChange={(db) => onChange(10 ** (db / 20))}
/>
