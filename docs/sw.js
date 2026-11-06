// Service worker: adds the isolation and CSP headers GitHub Pages cannot send,
// and caches the app so it works offline. The `serviceWorker` plugin in
// vite.config.ts fills in BUILD at build time.

const BUILD = {"version":"02d0cb73ee2a","shell":["index.html","manifest.webmanifest","assets/index-D_bQlufi.js","assets/AudioEditor-lFWs4D72.js","assets/ImageEditor-g-TkJz04.js","assets/ProjectMenu-Df_LeQJF.js","assets/RedactOverlay-Ddd-CBYk.js","assets/VideoEditor-BxOZkkCP.js","assets/dialog-content-COcpuQ7n.js","assets/session.svelte-DP2T8biJ.js","assets/audio.worker-DKH6fjP8.js","assets/av.worker-CDnPMs2k.js","assets/bebas-neue-latin-400-normal-9mHNbWWO.woff2","assets/caveat-latin-wght-normal-C1hSzPvX.woff2","assets/editor.worker-DCM1WTcd.js","assets/image.worker-BdWtmPzE.js","assets/index-DGXjD1S_.css","assets/inspect.worker-Dr_d3XwS.js","assets/inter-cyrillic-ext-wght-normal-BOeWTOD4.woff2","assets/inter-cyrillic-wght-normal-DqGufNeO.woff2","assets/inter-greek-ext-wght-normal-DlzME5K_.woff2","assets/inter-greek-wght-normal-CkhJZR-_.woff2","assets/inter-latin-ext-wght-normal-DO1Apj_S.woff2","assets/inter-latin-wght-italic-DpCbqKDY.woff2","assets/inter-latin-wght-normal-Dx4kXJAl.woff2","assets/inter-vietnamese-wght-normal-CBcvBZtf.woff2","assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2","assets/ring-processor-D43iBhW3.js","assets/roboto-slab-latin-wght-normal-NGSZfXMW.woff2","assets/video.worker-GmX0LIhw.js","assets/zip.worker-hpa4UGX4.js","assets/__vite-browser-external-CbVku3H2.js","assets/dist-DjLFPtfj.js","assets/encode-B8c9y_Xq.js","assets/rolldown-runtime--BTzx9g2.js","assets/zip-CPETS3Xm.js","favicon.svg","heart.png","icon-192.png","icon-512.png","icon-maskable-512.png"],"engines":["vips-0.0.19","magick-0.0.44","ffmpeg-0.12.10"],"headers":{"Cross-Origin-Opener-Policy":"same-origin","Cross-Origin-Embedder-Policy":"require-corp"},"csp":"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; manifest-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'","workerCsp":"default-src 'none'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; worker-src 'self' blob:; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; manifest-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'"};
const SHELL_CACHE = `shell-${BUILD.version}`;
const ENGINE_CACHE = 'engines';
const scope = new URL(self.registration.scope);
const enginePrefix = new URL('wasm/', scope).pathname;
const indexUrl = new URL('index.html', scope).href;
const shareUrl = new URL('share', scope).href;
// Contract with src/app/launch.ts: shared files wait in this cache until the page picks them up.
const SHARE_CACHE = 'shared-files';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(BUILD.shell.map((path) => new URL(path, scope).href)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('shell-') && key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(dropOldEngines)
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  const url = new URL(request.url);
  if (request.method === 'POST' && url.href.split('?')[0] === shareUrl) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== 'GET' || url.origin !== scope.origin) {
    event.respondWith(fetch(request).then((response) => withHeaders(response, request)));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, indexUrl));
  } else if (url.pathname.startsWith(enginePrefix)) {
    event.respondWith(cacheFirst(request, ENGINE_CACHE));
  } else {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  }
});

async function receiveShare(request) {
  const form = await request.formData();
  const cache = await caches.open(SHARE_CACHE);
  const files = form.getAll('files').filter((value) => typeof value !== 'string');
  await Promise.all(
    files.map((file, index) =>
      cache.put(
        new URL(`share/${Date.now()}-${index}`, scope).href,
        new Response(file, {
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name),
          },
        }),
      ),
    ),
  );
  return Response.redirect(new URL('./?shared', scope).href, 303);
}

// Engine files live under wasm/<engine>-<version>/; versions this build no longer uses are deleted.
async function dropOldEngines() {
  const cache = await caches.open(ENGINE_CACHE);
  const current = BUILD.engines.map((dir) => `${enginePrefix}${dir}/`);
  const requests = await cache.keys();
  await Promise.all(
    requests
      .filter(
        (request) => !current.some((prefix) => new URL(request.url).pathname.startsWith(prefix)),
      )
      .map((request) => cache.delete(request)),
  );
}

async function networkFirst(request, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(fallbackUrl, response.clone());
    }
    return withHeaders(response, request);
  } catch (error) {
    const cached = await caches.match(fallbackUrl);
    if (cached) return withHeaders(cached, request);
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return withHeaders(cached, request);
  let response;
  try {
    response = await fetch(request);
  } catch {
    return unreachable(request);
  }
  if (response.ok) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return withHeaders(response, request);
}

// Contract with src/engine/downloads.svelte.ts: this header marks a file the host could not be reached for.
function unreachable(request) {
  const response = new Response(null, {
    status: 503,
    statusText: 'Host unreachable',
    headers: { 'X-Host-Unreachable': '1' },
  });
  return withHeaders(response, request);
}

// Opaque responses (status 0) cannot be re-wrapped and must pass through.
function withHeaders(response, request) {
  if (response.status === 0) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(BUILD.headers)) headers.set(name, value);
  headers.set(
    'Content-Security-Policy',
    request.destination === 'worker' ? BUILD.workerCsp : BUILD.csp,
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
