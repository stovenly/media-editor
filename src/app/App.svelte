<script lang="ts">
  import Converter from '../converter/Converter.svelte';
  import { files } from '../converter/files.svelte';
  import DropTarget from './DropTarget.svelte';
  import ThemeToggle from './ui/ThemeToggle.svelte';
</script>

<DropTarget onFiles={(dropped) => files.add(dropped)} />

<div class="flex min-h-dvh flex-col">
  <header class="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-4">
    <span class="font-semibold tracking-tight">Media Editor</span>
    <ThemeToggle />
  </header>

  <main class="mx-auto w-full max-w-3xl flex-1 px-5 pb-16">
    <Converter />
  </main>
</div>
