<script lang="ts">
  import { Keyboard } from '@lucide/svelte';
  import Converter from '../converter/Converter.svelte';
  import { projects } from '../project/open.svelte';
  import ProjectDialog from '../project/ProjectDialog.svelte';
  import DropTarget from './DropTarget.svelte';
  import { shortcutHelp } from './shortcuts.svelte';
  import ShortcutsDialog from './ShortcutsDialog.svelte';
  import ThemeToggle from './ui/ThemeToggle.svelte';
</script>

<DropTarget onFiles={(dropped) => projects.intake(dropped)} />
<ProjectDialog />
<ShortcutsDialog />

<div class="flex min-h-dvh flex-col">
  <header class="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-4">
    <h1 class="font-semibold tracking-tight">Media Editor</h1>
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="icon-button"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        onclick={() => (shortcutHelp.open = true)}><Keyboard size={16} /></button
      >
      <ThemeToggle />
    </div>
  </header>

  <main class="mx-auto w-full max-w-3xl flex-1 px-5 pb-16">
    <Converter />
  </main>
</div>
