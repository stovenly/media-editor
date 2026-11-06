<script lang="ts">
  import Converter from '../converter/Converter.svelte';
  import { projects } from '../project/open.svelte';
  import ProjectDialog from '../project/ProjectDialog.svelte';
  import Corners from './Corners.svelte';
  import DropTarget from './DropTarget.svelte';
  import { receiveLaunchedFiles } from './launch';

  receiveLaunchedFiles((launched) => projects.intake(launched));
</script>

<DropTarget onFiles={(dropped) => projects.intake(dropped)} />
<ProjectDialog />
<Corners />

<div class="flex min-h-dvh flex-col">
  <header class="sticky top-0 z-20 h-12 shrink-0 border-b border-line bg-raised">
    <div class="mx-auto flex h-full max-w-[1400px] items-center px-10">
      <h1 class="font-semibold tracking-tight">Media Editor</h1>
    </div>
  </header>

  <main class="mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-10">
    <Converter />
  </main>
</div>
