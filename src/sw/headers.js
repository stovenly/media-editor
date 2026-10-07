// Response headers the app needs. The dev and preview servers send them
// natively; on GitHub Pages the service worker adds them (sw.js).

export const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/** @param {string} script */
const directives = (script) => [
  "default-src 'none'",
  `script-src ${script}`,
  "worker-src 'self' blob:",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
];

export const CSP = directives("'self' 'wasm-unsafe-eval'").join('; ');

// wasm-vips uses Embind, which generates its bindings with `new Function`. Only worker scripts get this.
export const WORKER_CSP = directives("'self' 'wasm-unsafe-eval' 'unsafe-eval'").join('; ');

/** @param {string | undefined} destination */
export function cspFor(destination) {
  return destination === 'worker' ? WORKER_CSP : CSP;
}

// Browsers ignore frame-ancestors in a <meta> policy and log an error for it.
export const CSP_META = CSP.split('; ')
  .filter((directive) => !directive.startsWith('frame-ancestors'))
  .join('; ');
