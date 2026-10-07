<script lang="ts">
  import { Monitor, Moon, Sun } from '@lucide/svelte';
  import { ToggleGroup } from 'bits-ui';
  import { setTheme, theme, type ThemeChoice } from '../theme.svelte';

  const options = [
    { value: 'system', label: 'System theme', icon: Monitor },
    { value: 'light', label: 'Light theme', icon: Sun },
    { value: 'dark', label: 'Dark theme', icon: Moon },
  ] as const;
</script>

<ToggleGroup.Root
  type="single"
  value={theme.choice}
  onValueChange={(value) => value && setTheme(value as ThemeChoice)}
  class="flex gap-0.5 rounded-full border border-line bg-raised p-0.5"
  aria-label="Theme"
>
  {#each options as option (option.value)}
    <ToggleGroup.Item
      value={option.value}
      aria-label={option.label}
      title={option.label}
      class="grid size-7 place-items-center rounded-full text-muted transition-colors hover:text-fg data-[state=on]:bg-accent-soft data-[state=on]:text-accent"
    >
      <option.icon size={15} />
    </ToggleGroup.Item>
  {/each}
</ToggleGroup.Root>
