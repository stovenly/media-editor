<script lang="ts" module>
  export type SelectOption<T extends string> = { value: T; label: string; style?: string };
</script>

<script lang="ts" generics="T extends string">
  import { Check, ChevronDown } from '@lucide/svelte';
  import { Select } from 'bits-ui';

  let {
    label,
    hideLabel = false,
    options,
    value,
    disabled = false,
    onChange,
  }: {
    label: string;
    hideLabel?: boolean;
    options: readonly SelectOption<T>[];
    value: T;
    disabled?: boolean;
    onChange: (value: T) => void;
  } = $props();

  const id = $props.id();
  const current = $derived(options.find((o) => o.value === value));

  function select(next: string) {
    if (next !== value && options.some((o) => o.value === next)) onChange(next as T);
  }
</script>

<div class="grid min-w-0 gap-1">
  {#if !hideLabel}<span id="{id}-label" class="text-xs text-muted">{label}</span>{/if}
  <Select.Root
    type="single"
    bind:value={() => value, select}
    items={options.map((o) => ({ value: o.value, label: o.label }))}
    {disabled}
  >
    <Select.Trigger
      aria-label={hideLabel ? label : undefined}
      aria-labelledby={hideLabel ? undefined : `${id}-label`}
      class="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-surface px-2 text-left text-sm transition-colors enabled:hover:border-accent disabled:opacity-40 data-[state=open]:border-accent"
    >
      <span class="min-w-0 flex-1 truncate" style={current?.style}>{current?.label ?? ''}</span>
      <ChevronDown size={14} class="shrink-0 text-muted" />
    </Select.Trigger>
    <Select.Portal>
      <Select.Content
        sideOffset={4}
        class="z-[60] min-w-(--bits-select-anchor-width) rounded-lg border border-line bg-raised p-1 shadow-lg outline-none"
      >
        <Select.Viewport class="max-h-64 overflow-y-auto">
          {#each options as o (o.value)}
            <Select.Item
              value={o.value}
              label={o.label}
              class="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none data-highlighted:bg-sunken"
            >
              {#snippet children({ selected })}
                <span class="min-w-0 flex-1 truncate" style={o.style}>{o.label}</span>
                {#if selected}<Check size={14} class="shrink-0 text-accent" />{/if}
              {/snippet}
            </Select.Item>
          {/each}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
</div>
