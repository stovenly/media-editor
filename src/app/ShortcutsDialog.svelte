<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { editing } from '../editors/editing.svelte';
  import {
    isTyping,
    SCREEN_LABELS,
    shortcutHelp,
    SHORTCUTS,
    type ShortcutScreen,
  } from './shortcuts.svelte';

  const screen = $derived.by((): ShortcutScreen => {
    const kind = editing.current?.item.inspection?.sniffed.kind;
    return kind === 'audio' || kind === 'video' ? kind : kind ? 'image' : 'converter';
  });

  function keydown(event: KeyboardEvent) {
    if (event.key === '?' && !event.ctrlKey && !event.metaKey && !isTyping(event.target)) {
      event.preventDefault();
      shortcutHelp.open = true;
    }
  }
</script>

<svelte:window onkeydown={keydown} />

<Dialog.Root bind:open={shortcutHelp.open}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-[60] bg-black/40" />
    <Dialog.Content
      class="fixed top-1/2 left-1/2 z-[60] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 space-y-3 rounded-2xl border border-line bg-raised p-5 shadow-xl outline-none"
    >
      <Dialog.Title class="font-semibold">Keyboard shortcuts · {SCREEN_LABELS[screen]}</Dialog.Title
      >
      <Dialog.Description class="sr-only">Keys for the screen you're on.</Dialog.Description>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {#each SHORTCUTS[screen] as shortcut (shortcut.action)}
          <dt>
            <kbd
              class="rounded-md border border-line bg-sunken px-1.5 py-0.5 font-mono text-xs whitespace-pre"
              >{shortcut.keys}</kbd
            >
          </dt>
          <dd>{shortcut.action}</dd>
        {/each}
      </dl>
      <div class="flex justify-end">
        <Dialog.Close class="rounded-full px-4 py-2 text-sm text-muted hover:text-fg"
          >Close</Dialog.Close
        >
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
