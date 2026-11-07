<script lang="ts">
  import type { LucideIcon } from '@lucide/svelte';
  import { Toggle } from 'bits-ui';

  let {
    label,
    pressed,
    icon,
    pressedIcon,
    disabled = false,
    onChange,
  }: {
    label: string;
    pressed: boolean;
    icon: LucideIcon;
    pressedIcon?: LucideIcon;
    disabled?: boolean;
    onChange: (pressed: boolean) => void;
  } = $props();

  const Shown = $derived(pressed && pressedIcon ? pressedIcon : icon);
</script>

<Toggle.Root
  bind:pressed={() => pressed, (next) => onChange(next)}
  {disabled}
  aria-label={label}
  title={label}
  class="grid size-8 shrink-0 place-items-center rounded-lg border transition-colors disabled:opacity-40 data-[state=off]:border-line data-[state=off]:text-muted data-[state=off]:enabled:hover:text-fg data-[state=on]:border-accent data-[state=on]:bg-accent-soft data-[state=on]:text-accent"
>
  <Shown size={15} />
</Toggle.Root>
