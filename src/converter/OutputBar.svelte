<script lang="ts">
  import { suggestions, target } from '../engine/targets';
  import { factsOf, files, type FileItem } from './files.svelte';
  import TargetMenu from './TargetMenu.svelte';

  let { item }: { item: FileItem } = $props();

  const KIND_NAMES = {
    image: 'image',
    video: 'video',
    audio: 'audio',
    subtitle: 'subtitle',
  } as const;

  const kind = $derived(item.inspection!.sniffed.kind!);
  const facts = $derived(factsOf(item.inspection));
  const chosen = $derived(files.targetOf(item));
  const chips = $derived.by(() => {
    const list = suggestions(item.inspection?.sniffed.format ?? '', kind, facts);
    if (chosen && !list.some((t) => t.id === chosen)) list.push(target(chosen));
    return list;
  });
</script>

<div class="space-y-3 p-5">
  <span class="block text-sm font-semibold">Convert to</span>
  <div class="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Output format">
    {#each chips as chip (chip.id)}
      <button
        type="button"
        role="radio"
        aria-checked={chosen === chip.id}
        title={chip.hint}
        class="rounded-full border px-3 py-1.5 text-sm font-medium transition-colors {chosen ===
        chip.id
          ? 'border-accent bg-accent text-on-accent'
          : 'border-line bg-raised hover:border-accent hover:text-accent'}"
        onclick={() => files.setTarget(item.id, chip.id)}
      >
        {chip.label}
      </button>
    {/each}
    <TargetMenu
      {kind}
      {facts}
      value={chosen}
      label="More {KIND_NAMES[kind]} formats"
      onPick={(id) => files.setTarget(item.id, id)}
    />
  </div>
</div>
