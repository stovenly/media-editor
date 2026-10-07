<script lang="ts">
  import { Bold, Italic } from '@lucide/svelte';
  import { BUNDLED_FONTS, FONT_EXTENSIONS } from '../../engine/video/fonts';
  import { ANCHORS, type Anchor, type ProjectFont, type TextStyle } from '../../project/text';

  let {
    style,
    fonts,
    onChange,
    onAddFont,
  }: {
    style: TextStyle;
    fonts: readonly ProjectFont[];
    onChange: (label: string, style: TextStyle) => void;
    onAddFont: (file: File) => Promise<string | null>;
  } = $props();

  let picker = $state<HTMLInputElement>();
  let fontError = $state<string | null>(null);

  const set = (label: string, patch: Partial<TextStyle>) => onChange(label, { ...style, ...patch });
  const num = (event: Event) => Number((event.currentTarget as HTMLInputElement).value);

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

  const boxColour = $derived(style.box?.slice(0, 7) ?? '#000000');
  const boxOpacity = $derived(style.box ? parseInt(style.box.slice(7, 9) || 'ff', 16) / 255 : 0.7);
  const hexAlpha = (a: number) =>
    Math.round(Math.min(1, Math.max(0, a)) * 255)
      .toString(16)
      .padStart(2, '0');

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

  const field = 'w-full min-w-0 rounded-lg border border-line bg-surface px-2 py-1 text-sm';
  const toggle = (on: boolean) =>
    `icon-button border ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line'}`;
</script>

<div class="space-y-2">
  <div class="flex items-end gap-1.5">
    <label class="grid min-w-0 flex-1 gap-1 text-xs">
      Font
      <select
        class={field}
        value={style.font}
        onchange={(e) => {
          const value = e.currentTarget.value;
          if (value === '+') {
            e.currentTarget.value = style.font;
            picker?.click();
          } else set('Font', { font: value });
        }}
      >
        {#each BUNDLED_FONTS as font (font.family)}<option value={font.family}>{font.label}</option
          >{/each}
        {#each fonts as font (font.id)}<option value={font.family}>{font.family}</option>{/each}
        <option value="+">Use a font file…</option>
      </select>
    </label>
    <button
      type="button"
      class={toggle(style.bold)}
      aria-label="Bold"
      aria-pressed={style.bold}
      onclick={() => set('Bold', { bold: !style.bold })}><Bold size={15} /></button
    >
    <button
      type="button"
      class={toggle(style.italic)}
      aria-label="Italic"
      aria-pressed={style.italic}
      onclick={() => set('Italic', { italic: !style.italic })}><Italic size={15} /></button
    >
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

  <div class="grid grid-cols-[1fr_auto] items-end gap-2">
    <label class="grid gap-1 text-xs"
      ><span class="flex justify-between"
        >Size <span class="text-muted">{Math.round(style.size * 100)}% of height</span></span
      ><input
        type="range"
        min="0.02"
        max="0.25"
        step="0.005"
        value={style.size}
        class="accent-accent"
        oninput={(e) => set('Text size', { size: num(e) })}
      /></label
    >
    <label class="grid gap-1 text-xs"
      >Colour<input
        type="color"
        value={style.color}
        class="h-7 w-10 rounded border border-line bg-surface"
        oninput={(e) => set('Text colour', { color: e.currentTarget.value })}
      /></label
    >
  </div>

  <div class="grid grid-cols-[1fr_auto] items-end gap-2">
    <label class="grid gap-1 text-xs"
      >Outline<input
        type="range"
        min="0"
        max="0.15"
        step="0.005"
        value={style.outline}
        class="accent-accent"
        oninput={(e) => set('Outline', { outline: num(e) })}
      /></label
    >
    <input
      type="color"
      value={style.outlineColor}
      class="h-7 w-10 rounded border border-line bg-surface"
      aria-label="Outline colour"
      oninput={(e) => set('Outline colour', { outlineColor: e.currentTarget.value })}
    />
  </div>

  <label class="flex items-center gap-2 text-xs"
    ><input
      type="checkbox"
      checked={style.shadow}
      onchange={(e) => set('Shadow', { shadow: e.currentTarget.checked })}
    /> Shadow</label
  >

  <div class="flex items-center gap-2 text-xs">
    <label class="flex items-center gap-2"
      ><input
        type="checkbox"
        checked={style.box !== null}
        onchange={(e) =>
          set('Background', {
            box: e.currentTarget.checked ? `${boxColour}${hexAlpha(boxOpacity)}` : null,
          })}
      /> Background</label
    >
    {#if style.box}
      <input
        type="color"
        value={boxColour}
        class="h-6 w-8 rounded border border-line bg-surface"
        aria-label="Background colour"
        oninput={(e) =>
          set('Background', { box: `${e.currentTarget.value}${hexAlpha(boxOpacity)}` })}
      />
      <input
        type="range"
        min="0.1"
        max="1"
        step="0.05"
        value={boxOpacity}
        class="min-w-0 flex-1 accent-accent"
        aria-label="Background opacity"
        oninput={(e) => set('Background', { box: `${boxColour}${hexAlpha(num(e))}` })}
      />
    {/if}
  </div>

  <fieldset class="space-y-1">
    <legend class="text-xs">Position</legend>
    <div class="grid grid-cols-3 gap-1 text-xs">
      {#each ANCHORS as anchor (anchor)}
        <button
          type="button"
          class="rounded-lg border px-1 py-1 {style.anchor === anchor
            ? 'border-accent bg-accent-soft text-accent'
            : 'border-line'}"
          aria-pressed={style.anchor === anchor}
          onclick={() => set('Position', { anchor })}>{ANCHOR_LABELS[anchor]}</button
        >
      {/each}
    </div>
  </fieldset>
  <label class="grid gap-1 text-xs"
    >Distance from the edge<input
      type="range"
      min="0"
      max="0.25"
      step="0.005"
      value={style.margin}
      class="accent-accent"
      oninput={(e) => set('Margin', { margin: num(e) })}
    /></label
  >
</div>
