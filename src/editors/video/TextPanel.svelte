<script lang="ts">
  import { Type } from '@lucide/svelte';
  import type { ProjectFont, TextClip, TextStyle } from '../../project/text';
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

  const num = (event: Event) => Number((event.currentTarget as HTMLInputElement).value);
  const field = 'w-full min-w-0 rounded-lg border border-line bg-surface px-2 py-1 text-sm';
</script>

<section class="space-y-2">
  <h3 class="inline-flex items-center gap-1.5 font-medium"><Type size={14} /> Text</h3>
  <textarea
    class="{field} min-h-16"
    aria-label="Text"
    value={clip.text}
    oninput={(e) => onChange('Text', { text: e.currentTarget.value })}></textarea>
  <div class="grid grid-cols-2 gap-2">
    <label class="grid gap-1 text-xs text-muted"
      >Starts at (s)<input
        type="number"
        step="0.1"
        min="0"
        class={field}
        value={clip.start.toFixed(1)}
        onchange={(e) => onChange('Text timing', { start: Math.max(0, num(e)) })}
      /></label
    >
    <label class="grid gap-1 text-xs text-muted"
      >Lasts (s)<input
        type="number"
        step="0.1"
        min="0.1"
        class={field}
        value={clip.duration.toFixed(1)}
        onchange={(e) => onChange('Text timing', { duration: Math.max(0.1, num(e)) })}
      /></label
    >
    <label class="grid gap-1 text-xs text-muted"
      >Fade in (s)<input
        type="number"
        step="0.1"
        min="0"
        class={field}
        value={clip.fadeIn}
        onchange={(e) => onChange('Text fade', { fadeIn: Math.max(0, num(e)) })}
      /></label
    >
    <label class="grid gap-1 text-xs text-muted"
      >Fade out (s)<input
        type="number"
        step="0.1"
        min="0"
        class={field}
        value={clip.fadeOut}
        onchange={(e) => onChange('Text fade', { fadeOut: Math.max(0, num(e)) })}
      /></label
    >
  </div>
  <TextStyleFields
    style={clip.style}
    {fonts}
    onChange={(label, style: TextStyle) => onChange(label, { style })}
    {onAddFont}
  />
</section>
