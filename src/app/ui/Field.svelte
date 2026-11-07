<script lang="ts">
  import type { Snippet } from 'svelte';
  import ResetButton from './ResetButton.svelte';

  let {
    label,
    hint,
    changed = false,
    onReset,
    children,
  }: {
    label: string;
    hint?: string;
    changed?: boolean;
    onReset?: () => void;
    children: Snippet;
  } = $props();

  const id = $props.id();
</script>

<div class="grid gap-1.5" role="group" aria-labelledby="{id}-label">
  <div class="flex min-h-5 items-center gap-2">
    <span id="{id}-label" class="text-xs text-muted">{label}</span>
    {#if changed && onReset}<ResetButton {label} onclick={onReset} />{/if}
  </div>
  {@render children()}
  {#if hint}<p class="text-xs text-muted">{hint}</p>{/if}
</div>
