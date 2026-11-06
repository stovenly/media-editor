<script lang="ts">
  import { Settings } from '@lucide/svelte';
  import { font, setDyslexic } from './font.svelte';
  import { setTheme, theme } from './theme.svelte';

  const REPO = 'https://github.com/stovenly/media-editor';
  const THEMES = [
    ['system', 'System'],
    ['light', 'Light'],
    ['dark', 'Dark'],
  ] as const;

  let open = $state<'settings' | 'about' | null>(null);
  const boxes: Record<'settings' | 'about', HTMLElement | undefined> = $state({
    settings: undefined,
    about: undefined,
  });

  function away(event: PointerEvent) {
    if (open && !boxes[open]?.contains(event.target as Node)) open = null;
  }

  function escape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !open) return;
    boxes[open]?.querySelector<HTMLButtonElement>('[aria-expanded]')?.focus();
    open = null;
  }

  const toggle = (which: 'settings' | 'about') => (open = open === which ? null : which);

  const button =
    'grid size-10 cursor-pointer place-items-center rounded-xl border border-line bg-raised/90 text-muted shadow-sm backdrop-blur transition-colors hover:border-accent hover:text-accent aria-expanded:border-accent aria-expanded:text-accent';
  const pop =
    'pop-in absolute bottom-13 w-max max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-raised px-5 py-4 shadow-lg';
  const link =
    'text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent';
</script>

<svelte:window onpointerdown={away} onkeydown={escape} />

<div bind:this={boxes.settings} class="fixed bottom-4 left-4 z-40">
  {#if open === 'settings'}
    <div class="{pop} left-0 flex flex-col gap-3.5 text-[0.95rem]">
      <div class="flex items-center justify-between gap-4">
        <span>Theme</span>
        <div
          class="flex gap-0.5 rounded-[10px] bg-sunken p-[3px]"
          role="radiogroup"
          aria-label="Theme"
        >
          {#each THEMES as [value, label] (value)}
            <button
              type="button"
              role="radio"
              aria-checked={theme.choice === value}
              class="cursor-pointer rounded-lg px-2.5 py-1 text-sm font-medium text-muted hover:text-fg aria-checked:bg-raised aria-checked:text-fg aria-checked:shadow-xs"
              onclick={() => setTheme(value)}>{label}</button
            >
          {/each}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={font.dyslexic}
        class="group flex w-full cursor-pointer items-center justify-between gap-4"
        onclick={() => setDyslexic(!font.dyslexic)}
      >
        <span>Dyslexia-friendly font</span>
        <span
          class="relative h-5 w-9 rounded-full bg-line transition-colors group-aria-checked:bg-accent"
        >
          <span
            class="absolute top-[3px] left-[3px] size-3.5 rounded-full bg-raised shadow-xs transition-[left] group-aria-checked:left-[19px]"
          ></span>
        </span>
      </button>
    </div>
  {/if}
  <button
    type="button"
    class={button}
    aria-label="Display settings"
    aria-expanded={open === 'settings'}
    onclick={() => toggle('settings')}><Settings size={18} /></button
  >
</div>

<div bind:this={boxes.about} class="fixed right-4 bottom-4 z-40">
  {#if open === 'about'}
    <div class="{pop} right-0 space-y-1 text-right">
      <p class="flex items-center justify-end gap-2 text-muted">
        <span
          >Made by <a
            class={link}
            href="https://stovenly.com/projects/media-editor/"
            target="_blank"
            rel="noopener noreferrer">stovenly</a
          ></span
        >
        <img src="{import.meta.env.BASE_URL}heart.png" alt="" class="h-[1.9em] w-auto" />
      </p>
      <p>
        <a
          class={link}
          href="{REPO}/blob/main/THIRD_PARTY_NOTICES"
          target="_blank"
          rel="noopener noreferrer">Credits</a
        >
      </p>
      <p><a class={link} href={REPO} target="_blank" rel="noopener noreferrer">Source code</a></p>
      <p>
        <a class={link} href="{REPO}/issues/new" target="_blank" rel="noopener noreferrer"
          >Report an issue</a
        >
      </p>
    </div>
  {/if}
  <button
    type="button"
    class="{button} text-lg leading-none font-bold"
    aria-label="About"
    aria-expanded={open === 'about'}
    onclick={() => toggle('about')}><span aria-hidden="true">?</span></button
  >
</div>
