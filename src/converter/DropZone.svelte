<script lang="ts">
  import { FolderOpen, ShieldCheck, Upload } from '@lucide/svelte';

  let { onFiles, compact = false }: { onFiles: (files: File[]) => void; compact?: boolean } =
    $props();

  let filePicker: HTMLInputElement;
  let folderPicker: HTMLInputElement;

  function picked(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    onFiles([...(input.files ?? [])].filter((file) => !file.name.startsWith('.')));
    input.value = '';
  }
</script>

<input bind:this={filePicker} type="file" multiple hidden onchange={picked} />
<input bind:this={folderPicker} type="file" webkitdirectory hidden onchange={picked} />

{#if compact}
  <div class="flex flex-wrap items-center gap-2">
    <button
      type="button"
      class="inline-flex items-center gap-2 rounded-full border border-line bg-raised px-4 py-2 text-sm font-medium transition-colors hover:border-accent hover:text-accent"
      onclick={() => filePicker.click()}
    >
      <Upload size={16} /> Add files
    </button>
    <button
      type="button"
      class="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-muted transition-colors hover:text-fg"
      onclick={() => folderPicker.click()}
    >
      <FolderOpen size={16} /> Add a folder
    </button>
  </div>
{:else}
  <section
    class="flex flex-col items-center gap-5 rounded-3xl border-2 border-dashed border-line bg-raised px-6 py-16 text-center"
  >
    <div class="grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent">
      <Upload size={26} />
    </div>
    <div class="space-y-1.5">
      <h1 class="text-2xl font-semibold tracking-tight">Convert and edit media</h1>
      <p class="text-muted">Drop images, audio or video anywhere on this page, or paste them.</p>
    </div>
    <div class="flex flex-wrap items-center justify-center gap-2">
      <button
        type="button"
        class="rounded-full bg-accent px-5 py-2.5 font-medium text-on-accent shadow-sm transition-colors hover:bg-accent-hover"
        onclick={() => filePicker.click()}
      >
        Choose files
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-muted transition-colors hover:text-fg"
        onclick={() => folderPicker.click()}
      >
        <FolderOpen size={18} /> Choose a folder
      </button>
    </div>
    <p class="inline-flex items-center gap-1.5 text-sm text-muted">
      <ShieldCheck size={15} /> Your files never leave this device.
    </p>
  </section>
{/if}
