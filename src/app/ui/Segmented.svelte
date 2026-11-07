<script lang="ts" module>
  import type { LucideIcon } from '@lucide/svelte';

  export type SegmentedOption<T extends string | number> = {
    value: T;
    label?: string;
    icon?: LucideIcon;
    tooltip?: string;
    disabled?: boolean;
  };
</script>

<script lang="ts" generics="T extends string | number">
  import type { Snippet } from 'svelte';
  import { ToggleGroup } from 'bits-ui';

  let {
    label,
    hideLabel = false,
    hint,
    options,
    value,
    disabled = false,
    onChange,
    option,
  }: {
    label: string;
    hideLabel?: boolean;
    hint?: string;
    options: readonly SegmentedOption<T>[];
    value: T | null;
    disabled?: boolean;
    onChange: (value: T) => void;
    option?: Snippet<[SegmentedOption<T>]>;
  } = $props();

  const id = $props.id();

  // ToggleGroup values are strings, and clicking the selected item clears it to ''.
  function select(next: string) {
    const picked = options.find((o) => String(o.value) === next);
    if (picked && !picked.disabled && picked.value !== value) onChange(picked.value);
  }

  // bits-ui moves focus on arrow keys without selecting; a radio group selects as focus moves.
  function keydown(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
      return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && event.currentTarget instanceof HTMLElement)
      if (event.currentTarget.contains(focused) && focused.dataset.value !== undefined)
        select(focused.dataset.value);
  }
</script>

<div class="grid gap-1">
  {#if !hideLabel}<span id="{id}-label" class="text-xs text-muted">{label}</span>{/if}
  <ToggleGroup.Root
    type="single"
    bind:value={() => (value === null ? '' : String(value)), select}
    {disabled}
    aria-label={hideLabel ? label : undefined}
    aria-labelledby={hideLabel ? undefined : `${id}-label`}
    aria-describedby={hint ? `${id}-hint` : undefined}
    onkeydown={keydown}
    class="flex min-h-8 gap-0.5 rounded-lg border border-line bg-sunken p-0.5"
  >
    {#each options as o (o.value)}
      <ToggleGroup.Item
        value={String(o.value)}
        disabled={o.disabled}
        aria-label={o.label ? undefined : o.tooltip}
        title={o.tooltip}
        class="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-1.5 py-1 text-sm transition-colors disabled:opacity-40 data-[state=off]:text-muted data-[state=off]:enabled:hover:text-fg data-[state=on]:bg-raised data-[state=on]:text-fg data-[state=on]:shadow-sm"
      >
        {#if option}
          {@render option(o)}
        {:else}
          {#if o.icon}<o.icon size={14} />{/if}
          {#if o.label}<span class="truncate">{o.label}</span>{/if}
        {/if}
      </ToggleGroup.Item>
    {/each}
  </ToggleGroup.Root>
  {#if hint}<p id="{id}-hint" class="text-xs text-muted">{hint}</p>{/if}
</div>
