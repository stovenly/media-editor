<script lang="ts">
  import { Volume1, Volume2, VolumeX } from '@lucide/svelte';
  import type { AudioSession } from '../audio/session.svelte';

  let { session }: { session: AudioSession } = $props();
  const silent = $derived(session.muted || session.volume === 0);
</script>

<div class="inline-flex items-center gap-1" role="group" aria-label="Playback volume">
  <button
    type="button"
    class="icon-button"
    aria-label={silent ? 'Unmute playback' : 'Mute playback'}
    aria-pressed={session.muted}
    title="Only changes what you hear, not the export"
    onclick={() => session.setVolume(session.volume || 0.8, !session.muted)}
  >
    {#if silent}<VolumeX size={16} />{:else if session.volume < 0.5}<Volume1
        size={16}
      />{:else}<Volume2 size={16} />{/if}
  </button>
  <input
    type="range"
    min="0"
    max="1"
    step="0.01"
    class="w-20 accent-accent"
    aria-label="Playback volume"
    title="Only changes what you hear, not the export"
    value={session.muted ? 0 : session.volume}
    oninput={(e) => session.setVolume(Number(e.currentTarget.value))}
  />
</div>
