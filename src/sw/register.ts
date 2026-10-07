// On a first visit to a header-less host the page is not isolated yet; reload
// once the worker controls it so the document arrives with the headers.
const RELOADED = 'sw-reloaded';

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const reloadIfNeeded = () => {
    if (window.crossOriginIsolated || !navigator.serviceWorker.controller) return;
    if (sessionStorage.getItem(RELOADED)) return;
    sessionStorage.setItem(RELOADED, '1');
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', reloadIfNeeded);
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
    .then(reloadIfNeeded, () => {});
  void navigator.storage?.persist?.();
}
