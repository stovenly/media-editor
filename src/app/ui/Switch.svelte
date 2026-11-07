<script lang="ts">
  import { Switch } from 'bits-ui';

  let {
    label,
    hint,
    checked,
    disabled = false,
    onChange,
  }: {
    label: string;
    hint?: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
  } = $props();

  const id = $props.id();
</script>

<div class="flex items-start justify-between gap-3">
  <div class="min-w-0 py-1.5 text-xs">
    <label for={id}>{label}</label>
    {#if hint}<p id="{id}-hint" class="mt-0.5 text-muted">{hint}</p>{/if}
  </div>
  <Switch.Root
    {id}
    bind:checked={() => checked, (next) => onChange(next)}
    {disabled}
    aria-describedby={hint ? `${id}-hint` : undefined}
    class="mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-40 data-[state=checked]:bg-accent data-[state=unchecked]:bg-muted/50"
  >
    <Switch.Thumb
      class="block size-4 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-4"
    />
  </Switch.Root>
</div>
