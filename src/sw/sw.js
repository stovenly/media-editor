// Service worker: adds the isolation and CSP headers GitHub Pages cannot send,
// and caches the app so it works offline. The `serviceWorker` plugin in
// vite.config.ts fills in BUILD at build time.

const BUILD = __BUILD__;
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
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
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
