<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Switch } from 'bits-ui';

  let {
    label,
    checked,
    disabled = false,
    onChange,
    children,
  }: {
    label: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
    children: Snippet;
  } = $props();

  const id = $props.id();
</script>

<div class="space-y-2">
  <div class="flex min-h-8 items-center justify-between gap-3">
    <h4 class="text-xs font-medium"><label for={id}>{label}</label></h4>
    <Switch.Root
      {id}
      bind:checked={() => checked, (next) => onChange(next)}
      {disabled}
      class="inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-40 data-[state=checked]:bg-accent data-[state=unchecked]:bg-muted/50"
    >
      <Switch.Thumb
        class="block size-4 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-4"
      />
    </Switch.Root>
  </div>
  {#if checked}
    <div class="space-y-2">{@render children()}</div>
  {/if}
</div>
