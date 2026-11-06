const KEY = 'dyslexic-font';
const URL = `${import.meta.env.BASE_URL}fonts/OpenDyslexic-Regular.otf`;

let status: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';

export const font = $state({ dyslexic: localStorage.getItem(KEY) === '1' });

export function setDyslexic(on: boolean): void {
  font.dyslexic = on;
  if (on) localStorage.setItem(KEY, '1');
  else localStorage.removeItem(KEY);
  apply();
}

// app.css swaps the type stack behind html.dyslexic once the font has loaded.
function apply(): void {
  document.documentElement.classList.toggle('dyslexic', font.dyslexic && status === 'ready');
  if (!font.dyslexic || status !== 'idle') return;
  status = 'loading';
  new FontFace('OpenDyslexic', `url(${URL})`)
    .load()
    .then((face) => {
      document.fonts.add(face);
      status = 'ready';
      apply();
    })
    .catch(() => (status = 'failed'));
}

apply();
