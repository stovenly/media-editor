<script lang="ts" module>
  const remembered = new Map<string, boolean>();
</script>

<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { ChevronDown, type LucideIcon } from '@lucide/svelte';
  import { Collapsible } from 'bits-ui';

  let {
    id,
    title,
    detail,
    icon: Icon,
    label,
    level = 3,
    collapsible = true,
    defaultOpen = true,
    children,
  }: {
    id: string;
    title: string;
    detail?: string;
    icon?: LucideIcon;
    label?: string;
    level?: 3 | 4;
    collapsible?: boolean;
    defaultOpen?: boolean;
    children: Snippet;
  } = $props();

  const headingId = $props.id();
  let open = $state(untrack(() => remembered.get(id) ?? defaultOpen));

  function setOpen(next: boolean) {
    open = next;
    remembered.set(id, next);
  }
</script>

{#snippet heading()}
  {#if Icon}<Icon size={14} class="shrink-0" />{/if}
  <span class="truncate">{title}</span>
  {#if detail}<span class="truncate font-normal text-muted">· {detail}</span>{/if}
{/snippet}

<section class="space-y-2" aria-label={label} aria-labelledby={label ? undefined : headingId}>
  {#if collapsible}
    <Collapsible.Root bind:open={() => open, setOpen}>
      <svelte:element this={`h${level}`} id={headingId} class="font-medium">
        <Collapsible.Trigger
          class="group flex w-full min-w-0 items-center gap-1.5 text-left {level === 4
            ? 'text-xs'
            : ''}"
        >
          {@render heading()}
          <ChevronDown
            size={14}
            class="ml-auto shrink-0 text-muted transition-transform group-data-[state=closed]:-rotate-90"
          />
        </Collapsible.Trigger>
      </svelte:element>
      <Collapsible.Content class="space-y-2 pt-2">{@render children()}</Collapsible.Content>
    </Collapsible.Root>
  {:else}
    <svelte:element
      this={`h${level}`}
      id={headingId}
      class="flex min-w-0 items-center gap-1.5 font-medium {level === 4 ? 'text-xs' : ''}"
    >
      {@render heading()}
    </svelte:element>
    <div class="space-y-2">{@render children()}</div>
  {/if}
</section>
