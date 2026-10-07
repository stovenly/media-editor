// The keyboard shortcuts of each screen, as shown in the shortcuts dialog. Each screen handles its own keys.

export type ShortcutScreen = 'converter' | 'image' | 'audio' | 'video';

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = mac ? '⌘' : 'Ctrl';

const EDITING = [
  { keys: `${MOD} Z`, action: 'Undo' },
  { keys: `${MOD} Shift Z  or  ${MOD} Y`, action: 'Redo' },
  { keys: `${MOD} S`, action: 'Save the project file' },
];

export const SHORTCUTS: Record<ShortcutScreen, { keys: string; action: string }[]> = {
  converter: [
    { keys: `${MOD} O`, action: 'Add files' },
    { keys: `${MOD} V`, action: 'Paste files or an image' },
    { keys: `${MOD} Enter`, action: 'Convert' },
    { keys: '?', action: 'Show these shortcuts' },
  ],
  image: [
    ...EDITING,
    { keys: 'R  /  Shift R', action: 'Rotate right / left' },
    { keys: 'F  /  Shift F', action: 'Flip horizontally / vertically' },
    { keys: 'Hold Space', action: 'Compare with the original' },
    { keys: 'Delete', action: 'Remove the selected covered area' },
    { keys: 'Esc', action: 'Close the editor' },
  ],
  audio: [
    ...EDITING,
    { keys: 'Space', action: 'Play or pause' },
    { keys: '← / →', action: 'Move the playhead 1 s (Shift: 10 s)' },
    { keys: '[  /  ]', action: 'Select the previous / next clip' },
    { keys: 'S', action: 'Split at the playhead' },
    { keys: 'Delete', action: 'Delete the selection or clip' },
    { keys: 'Esc', action: 'Close the editor' },
  ],
  video: [
    ...EDITING,
    { keys: 'Space', action: 'Play or pause' },
    { keys: '← / →', action: 'Previous / next frame' },
    { keys: '[  /  ]', action: 'Select the previous / next item' },
    { keys: 'S', action: 'Split at the playhead' },
    { keys: 'T', action: 'Add text at the playhead' },
    { keys: 'Delete', action: 'Delete the selected item' },
    { keys: 'Esc', action: 'Close the editor' },
  ],
};

export const SCREEN_LABELS: Record<ShortcutScreen, string> = {
  converter: 'Converter',
  image: 'Image editor',
  audio: 'Audio editor',
  video: 'Video editor',
};

export function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('input, select, textarea, [contenteditable]'))
  );
}

class ShortcutHelp {
  open = $state(false);
}

export const shortcutHelp = new ShortcutHelp();
