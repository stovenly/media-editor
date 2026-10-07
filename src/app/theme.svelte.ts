export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'theme';

function read(): ThemeChoice {
  const stored = localStorage.getItem(KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function apply(choice: ThemeChoice): void {
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
}

export const theme = $state({ choice: read() });

export function setTheme(choice: ThemeChoice): void {
  theme.choice = choice;
  if (choice === 'system') localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, choice);
  apply(choice);
}

apply(theme.choice);
