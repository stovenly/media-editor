<script lang="ts">
  import { CircleCheck, CircleDashed, LoaderCircle } from '@lucide/svelte';
  import { Dialog } from 'bits-ui';
  import { untrack } from 'svelte';
  import { formatBytes } from '../app/format';
  import { files } from '../converter/files.svelte';
  import { FONT_EXTENSIONS } from '../engine/video/fonts';
  import { projects } from './open.svelte';

  const pending = $derived(projects.pending);
  const open = $derived(Boolean(pending || projects.error));
  const missingFonts = $derived(
    pending?.saved.kind === 'video'
      ? (pending.saved.project.fonts ?? []).filter((f) => !pending.fonts.has(f.id))
      : [],
  );

  $effect(() => {
    void files.items;
    untrack(() => void projects.match());
  });

  let mediaPicker = $state<HTMLInputElement>();
  let fontPicker = $state<HTMLInputElement>();
  const picked = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const list = [...(input.files ?? [])];
    input.value = '';
    return list;
  };
</script>

<Dialog.Root {open} onOpenChange={(next) => !next && projects.cancel()}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-black/40" />
    <Dialog.Content
      class="fixed top-1/2 left-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-2xl border border-line bg-raised p-5 shadow-xl outline-none"
    >
      <Dialog.Title class="font-semibold">
        Open project{pending ? ` · ${pending.name}` : ''}
      </Dialog.Title>
      <Dialog.Description class="text-sm text-muted">
        {#if pending && projects.missing().length}
          Add the files this project uses. They're matched by their contents, so renamed files are
          found too. You can also drop them anywhere on the page.
        {:else if pending}
          Opening…
        {:else}
          This project couldn't be opened.
        {/if}
      </Dialog.Description>

      {#if pending}
        <ul class="max-h-64 space-y-1 overflow-y-auto text-sm" aria-label="Project files">
          {#each pending.saved.assets as asset (asset.id)}
            {@const found = pending.matched.has(asset.id)}
            <li class="flex items-center gap-2">
              {#if found}<CircleCheck size={15} class="shrink-0 text-success" aria-label="Found" />
              {:else}<CircleDashed
                  size={15}
                  class="shrink-0 text-muted"
                  aria-label="Missing"
                />{/if}
              <span class="min-w-0 flex-1 truncate">{asset.name}</span>
              <span class="shrink-0 text-muted tabular-nums">{formatBytes(asset.size)}</span>
            </li>
          {/each}
        </ul>
        {#if projects.missing().length}
          <button
            type="button"
            class="rounded-full bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
            onclick={() => mediaPicker?.click()}>Choose files…</button
          >
        {:else}
          <p class="inline-flex items-center gap-2 text-sm text-muted">
            <LoaderCircle size={14} class="animate-spin" /> Reading the files…
          </p>
        {/if}
        {#if missingFonts.length}
          <div class="space-y-1 rounded-xl bg-sunken p-3 text-sm">
            <p>
              Fonts this project uses: {missingFonts.map((f) => f.name).join(', ')}. Without them
              the text uses a standard font.
            </p>
            <button
              type="button"
              class="rounded-full border border-line px-3 py-1 text-xs hover:border-accent"
              onclick={() => fontPicker?.click()}>Choose font files…</button
            >
          </div>
        {/if}
      {/if}
      {#if projects.error}<p class="text-sm text-danger" role="alert">{projects.error}</p>{/if}

      <input
        bind:this={mediaPicker}
        type="file"
        multiple
        class="hidden"
        aria-label="Project media files"
        onchange={(e) => projects.intake(picked(e))}
      />
      <input
        bind:this={fontPicker}
        type="file"
        multiple
        class="hidden"
        accept={FONT_EXTENSIONS.join(',')}
        aria-label="Project font files"
        onchange={(e) => projects.addFonts(picked(e))}
      />
      <div class="flex justify-end">
        <Dialog.Close class="rounded-full px-4 py-2 text-sm text-muted hover:text-fg"
          >Cancel</Dialog.Close
        >
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
