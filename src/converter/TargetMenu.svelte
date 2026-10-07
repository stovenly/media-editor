<script lang="ts">
  import { Check, ChevronDown } from '@lucide/svelte';
  import { Command, Popover } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { GROUP_LABELS, targetsFor, type Facts, type TargetGroup } from '../engine/targets';
  import type { MediaKind } from '../io/formats';

  let {
    kind,
    facts = {},
    value,
    onPick,
    trigger,
    label,
  }: {
    kind: MediaKind;
    facts?: Facts;
    value: string | null;
    onPick: (id: string) => void;
    trigger?: Snippet;
    label: string;
  } = $props();

  let open = $state(false);

  const groups = $derived.by(() => {
    const byGroup = new Map<TargetGroup, ReturnType<typeof targetsFor>>();
    for (const t of targetsFor(kind, facts))
      byGroup.set(t.group, [...(byGroup.get(t.group) ?? []), t]);
    return [...byGroup];
  });

  function pick(id: string) {
    onPick(id);
    open = false;
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    aria-label={label}
    class="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-raised px-3 py-1.5 text-sm font-medium whitespace-nowrap text-fg transition-colors hover:border-accent data-[state=open]:border-accent"
  >
    {#if trigger}{@render trigger()}{:else}More formats{/if}
    <ChevronDown size={14} class="text-muted" />
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      sideOffset={6}
      align="start"
      class="z-50 w-72 overflow-hidden rounded-2xl border border-line bg-raised shadow-xl outline-none"
    >
      <Command.Root label="Output format" class="flex max-h-96 flex-col">
        <Command.Input
          placeholder="Search formats"
          class="border-b border-line bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted"
        />
        <Command.List class="overflow-y-auto p-1.5">
          <Command.Viewport>
            <Command.Empty class="px-3 py-6 text-center text-sm text-muted"
              >No matching format</Command.Empty
            >
            {#each groups as [group, list] (group)}
              <Command.Group value={group}>
                <Command.GroupHeading
                  class="px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-muted uppercase"
                >
                  {GROUP_LABELS[group]}
                </Command.GroupHeading>
                <Command.GroupItems>
                  {#each list as t (t.id)}
                    <Command.Item
                      value={t.id}
                      keywords={[t.label, t.ext, t.hint ?? '']}
                      onSelect={() => pick(t.id)}
                      class="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm data-selected:bg-sunken"
                    >
                      <span class="flex-1">
                        <span class="font-medium">{t.label}</span>
                        {#if t.hint}<span class="block text-xs text-muted">{t.hint}</span>{/if}
                      </span>
                      {#if t.id === value}<Check size={15} class="text-accent" />{/if}
                    </Command.Item>
                  {/each}
                </Command.GroupItems>
              </Command.Group>
            {/each}
          </Command.Viewport>
        </Command.List>
      </Command.Root>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
