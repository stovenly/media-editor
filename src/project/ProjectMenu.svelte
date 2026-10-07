<script lang="ts">
  import { LoaderCircle, Save } from '@lucide/svelte';
  import { DropdownMenu } from 'bits-ui';
  import { messageOf } from '../engine/errors';

  let { onSave }: { onSave: (bundle: boolean) => Promise<void> } = $props();

  let saving = $state(false);
  let error = $state<string | null>(null);

  export async function save(bundle: boolean) {
    saving = true;
    error = null;
    try {
      await onSave(bundle);
    } catch (e) {
      error = messageOf(e);
    } finally {
      saving = false;
    }
  }

  const itemClass =
    'block cursor-default rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-accent-soft';
</script>

{#if error}<span class="text-xs text-danger" role="alert">{error}</span>{/if}
<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted hover:text-fg data-[state=open]:text-fg"
    disabled={saving}
  >
    {#if saving}<LoaderCircle size={15} class="animate-spin" />{:else}<Save size={15} />{/if}
    Save project
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      class="z-[60] w-72 rounded-xl border border-line bg-raised p-1 shadow-lg"
      sideOffset={6}
      align="end"
    >
      <DropdownMenu.Item class={itemClass} onSelect={() => void save(false)}>
        <span class="font-medium">Project file</span>
        <span class="block text-xs text-muted"
          >Small. Reopen it here with the same files. (Ctrl+S)</span
        >
      </DropdownMenu.Item>
      <DropdownMenu.Item class={itemClass} onSelect={() => void save(true)}>
        <span class="font-medium">Project with media (ZIP)</span>
        <span class="block text-xs text-muted"
          >Includes every file and font, for another computer.</span
        >
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
