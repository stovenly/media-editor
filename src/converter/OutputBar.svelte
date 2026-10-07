<script lang="ts">
  import { suggestions, target } from '../engine/targets';
  import type { MediaKind } from '../io/formats';
  import { factsOf, files } from './files.svelte';
  import TargetMenu from './TargetMenu.svelte';

  const KIND_LABELS: Record<MediaKind, string> = {
    image: 'Images',
    video: 'Videos',
    audio: 'Audio',
  };

  const rows = $derived(
    files.kinds().map((kind) => {
      const counts = new Map<string, number>();
      const facts = { animated: false, motion: false };
      for (const item of files.items) {
        const format = item.inspection?.sniffed.format;
        if (item.inspection?.sniffed.kind !== kind || !format) continue;
        counts.set(format, (counts.get(format) ?? 0) + 1);
        const f = factsOf(item.inspection);
        facts.animated ||= Boolean(f.animated);
        facts.motion ||= Boolean(f.motion);
      }
      const common = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      const chips = suggestions(common, kind, facts);
      const chosen = files.defaults[kind];
      if (chosen && !chips.some((t) => t.id === chosen)) chips.push(target(chosen));
      return { kind, chips, chosen, facts };
    }),
  );
</script>

<div class="space-y-3 rounded-2xl border border-line bg-raised p-4 shadow-xs">
  {#each rows as row (row.kind)}
    <div class="flex flex-wrap items-center gap-2">
      <span class="w-full text-sm font-medium text-muted sm:w-auto sm:min-w-28">
        {rows.length > 1 ? `${KIND_LABELS[row.kind]} to` : 'Convert to'}
      </span>
      <div
        class="flex flex-wrap items-center gap-1.5"
        role="radiogroup"
        aria-label="{KIND_LABELS[row.kind]} output"
      >
        {#each row.chips as chip (chip.id)}
          <button
            type="button"
            role="radio"
            aria-checked={row.chosen === chip.id}
            title={chip.hint}
            class="rounded-full border px-3 py-1.5 text-sm font-medium transition-colors {row.chosen ===
            chip.id
              ? 'border-accent bg-accent text-on-accent'
              : 'border-line bg-raised hover:border-accent hover:text-accent'}"
            onclick={() => files.setDefault(row.kind, chip.id)}
          >
            {chip.label}
          </button>
        {/each}
        <TargetMenu
          kind={row.kind}
          facts={row.facts}
          value={row.chosen}
          label="More {KIND_LABELS[row.kind].toLowerCase()} formats"
          onPick={(id) => files.setDefault(row.kind, id)}
        />
      </div>
    </div>
  {/each}
</div>
