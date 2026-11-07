<script lang="ts">
  import { Type } from '@lucide/svelte';
  import NumberField from '../../app/ui/NumberField.svelte';
  import Section from '../../app/ui/Section.svelte';
  import Slider from '../../app/ui/Slider.svelte';
  import { TITLE_STYLE, type ProjectFont, type TextClip, type TextStyle } from '../../project/text';
  import TextStyleFields from './TextStyleFields.svelte';

  let {
    clip,
    fonts,
    onChange,
    onAddFont,
  }: {
    clip: TextClip;
    fonts: readonly ProjectFont[];
    onChange: (label: string, patch: Partial<TextClip>) => void;
    onAddFont: (file: File) => Promise<string | null>;
  } = $props();

  const fadeMax = $derived(Math.max(0.1, Math.min(10, clip.duration / 2)));
</script>

<Section id="text" title="Text" icon={Type} label="Text clip">
  <textarea
    class="min-h-16 w-full min-w-0 rounded-lg border border-line bg-surface px-2 py-1 text-sm"
    aria-label="Text"
    value={clip.text}
    oninput={(e) => onChange('Text', { text: e.currentTarget.value })}></textarea>
  <div class="grid grid-cols-2 gap-2">
    <NumberField
      label="Starts at"
      time
      min={0}
      value={clip.start}
      onChange={(start) => onChange('Text timing', { start })}
    />
    <NumberField
      label="Lasts"
      time
      min={0.1}
      value={clip.duration}
      onChange={(duration) => onChange('Text timing', { duration })}
    />
  </div>
  <Slider
    label="Fade in"
    value={clip.fadeIn}
    min={0}
    max={fadeMax}
    step={0.1}
    defaultValue={0}
    unit="s"
    onChange={(fadeIn) => onChange('Text fade', { fadeIn })}
  />
  <Slider
    label="Fade out"
    value={clip.fadeOut}
    min={0}
    max={fadeMax}
    step={0.1}
    defaultValue={0}
    unit="s"
    onChange={(fadeOut) => onChange('Text fade', { fadeOut })}
  />
  <TextStyleFields
    style={clip.style}
    defaults={TITLE_STYLE}
    {fonts}
    placement={false}
    onChange={(label, style: TextStyle) => onChange(label, { style })}
    {onAddFont}
  />
</Section>
