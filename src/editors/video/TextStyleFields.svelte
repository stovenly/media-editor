<script lang="ts" module>
  import { BUNDLED_FONTS } from '../../engine/video/fonts';

  // The worker draws with its own copies; these let the font list show each face.
  let previewed = false;
  function previewFonts() {
    if (previewed || typeof FontFace === 'undefined') return;
    previewed = true;
    for (const font of BUNDLED_FONTS)
      for (const face of font.faces)
        document.fonts.add(
          new FontFace(font.family, `url(${face.url})`, { style: face.style, weight: face.weight }),
        );
  }
</script>

<script lang="ts">
  import { Bold, Italic } from '@lucide/svelte';
  import ColourField from '../../app/ui/ColourField.svelte';
  import IconToggle from '../../app/ui/IconToggle.svelte';
  import SectionToggle from '../../app/ui/SectionToggle.svelte';
  import Select from '../../app/ui/Select.svelte';
  import Slider from '../../app/ui/Slider.svelte';
  import Switch from '../../app/ui/Switch.svelte';
  import { FONT_EXTENSIONS } from '../../engine/video/fonts';
  import { ANCHORS, type Anchor, type ProjectFont, type TextStyle } from '../../project/text';

  let {
    style,
    defaults,
    fonts,
    placement = true,
    onChange,
    onAddFont,
  }: {
    style: TextStyle;
    defaults: TextStyle;
    placement?: boolean;
    fonts: readonly ProjectFont[];
    onChange: (label: string, style: TextStyle) => void;
    onAddFont: (file: File) => Promise<string | null>;
  } = $props();

  previewFonts();

  let picker = $state<HTMLInputElement>();
  let fontError = $state<string | null>(null);

  const set = (label: string, patch: Partial<TextStyle>) => onChange(label, { ...style, ...patch });

  const ANCHOR_LABELS: Record<Anchor, string> = {
    'top-left': 'Top left',
    top: 'Top',
    'top-right': 'Top right',
    left: 'Left',
    center: 'Centre',
    right: 'Right',
    'bottom-left': 'Bottom left',
    bottom: 'Bottom',
    'bottom-right': 'Bottom right',
  };

  const ADD_FONT = '+';
  const fontOptions = $derived([
    ...BUNDLED_FONTS.map((f) => ({
      value: f.family,
      label: f.label,
      style: `font-family: '${f.family}'`,
    })),
    ...fonts.map((f) => ({ value: f.family, label: f.family })),
    { value: ADD_FONT, label: 'Use a font file…' },
  ]);

  const OUTLINE_ON = 0.06;
  const BOX_ON = '#000000b3';

  let lastOutline = $state(0);
  let lastBox = $state<string | null>(null);
  $effect.pre(() => {
    if (style.outline > 0) lastOutline = style.outline;
    if (style.box) lastBox = style.box;
  });

  async function pickFont(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    fontError = null;
    try {
      const family = await onAddFont(file);
      if (family) set('Font', { font: family });
    } catch (error) {
      fontError = error instanceof Error ? error.message : String(error);
    }
  }
</script>

<div class="space-y-2">
  <div class="flex items-end gap-1.5">
    <div class="min-w-0 flex-1">
      <Select
        label="Font"
        options={fontOptions}
        value={style.font}
        onChange={(font) => (font === ADD_FONT ? picker?.click() : set('Font', { font }))}
      />
    </div>
    <IconToggle
      label="Bold"
      icon={Bold}
      pressed={style.bold}
      onChange={(bold) => set('Bold', { bold })}
    />
    <IconToggle
      label="Italic"
      icon={Italic}
      pressed={style.italic}
      onChange={(italic) => set('Italic', { italic })}
    />
  </div>
  <input
    bind:this={picker}
    type="file"
    class="hidden"
    accept={FONT_EXTENSIONS.join(',')}
    aria-label="Font file"
    onchange={pickFont}
  />
  {#if fontError}<p class="text-xs text-danger">{fontError}</p>{/if}

  <Slider
    label="Size (% of height)"
    value={style.size * 100}
    min={2}
    max={25}
    step={0.5}
    defaultValue={defaults.size * 100}
    unit="%"
    onChange={(v) => set('Text size', { size: v / 100 })}
  />
  <ColourField
    label="Text colour"
    value={style.color}
    onChange={(color) => set('Text colour', { color })}
  />

  <SectionToggle
    label="Outline"
    checked={style.outline > 0}
    onChange={(on) =>
      set('Outline', { outline: on ? lastOutline || defaults.outline || OUTLINE_ON : 0 })}
  >
    <Slider
      label="Width (% of text size)"
      value={style.outline * 100}
      min={0.5}
      max={15}
      step={0.5}
      defaultValue={(defaults.outline || OUTLINE_ON) * 100}
      unit="%"
      onChange={(v) => set('Outline', { outline: v / 100 })}
    />
    <ColourField
      label="Outline colour"
      value={style.outlineColor}
      onChange={(outlineColor) => set('Outline colour', { outlineColor })}
    />
  </SectionToggle>

  <Switch label="Shadow" checked={style.shadow} onChange={(shadow) => set('Shadow', { shadow })} />

  <SectionToggle
    label="Background"
    checked={style.box !== null}
    onChange={(on) => set('Background', { box: on ? (lastBox ?? defaults.box ?? BOX_ON) : null })}
  >
    {#if style.box}
      <ColourField
        label="Background colour"
        alpha
        value={style.box}
        onChange={(box) => set('Background', { box })}
      />
    {/if}
  </SectionToggle>

  {#if placement}
    <fieldset class="space-y-1">
      <legend class="text-xs">Position</legend>
      <div class="grid grid-cols-3 gap-1 text-xs">
        {#each ANCHORS as anchor (anchor)}
          <button
            type="button"
            class="rounded-lg border px-1 py-1 {style.anchor === anchor
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-line hover:border-accent hover:text-accent'}"
            aria-pressed={style.anchor === anchor}
            onclick={() => set('Position', { anchor })}>{ANCHOR_LABELS[anchor]}</button
          >
        {/each}
      </div>
    </fieldset>
    <Slider
      label="Distance from the edge"
      value={style.margin * 100}
      min={0}
      max={25}
      step={0.5}
      defaultValue={defaults.margin * 100}
      unit="%"
      onChange={(v) => set('Margin', { margin: v / 100 })}
    />
  {/if}
</div>
