# Self-hosting

Media Editor is a static site. It has no server-side code, collects nothing and
uploads nothing, so any web server or static host that can serve files over
HTTPS can run it.

## Build

```sh
npm ci
npm run build                       # served from the site root
BASE_PATH=/media-editor/ npm run build   # served from a sub-path
```

The output is `dist/`, about 70 MB. Most of it is the WebAssembly engines in
`dist/wasm/<engine>-<version>/`, which are only downloaded the first time a
conversion needs them. A first visit downloads about 4 MB.

`npm run build` copies the engines out of `node_modules` first
(`npm run vendor`), so the versions you ship are the ones pinned in
`package-lock.json`.

## Requirements of the host

- **HTTPS.** Service workers, WebCodecs and `SharedArrayBuffer` only work in a
  secure context. `localhost` counts as secure for testing.
- **Correct MIME types** for `.js` and `.mjs` (`text/javascript`), `.wasm`
  (`application/wasm`) and `.webmanifest` (`application/manifest+json`). A
  wrong `.wasm` type still works, but compiles more slowly.
- **No response headers are required.** Cross-origin isolation (`COOP` and
  `COEP`) and the Content Security Policy are added by the service worker
  (`sw.js`). On the very first visit the page reloads once, after the worker
  takes control, to pick them up.

### Sending the headers yourself

If your server can set response headers, send them directly. This skips the
first-visit reload and protects the first page load too. The values live in
`src/sw/headers.js`:

| Header                         | Value                                         |
| ------------------------------ | --------------------------------------------- |
| `Cross-Origin-Opener-Policy`   | `same-origin`                                 |
| `Cross-Origin-Embedder-Policy` | `require-corp`                                |
| `Content-Security-Policy`      | `CSP` for documents, `WORKER_CSP` for workers |

Workers need `'unsafe-eval'` because wasm-vips generates its bindings at run
time; documents don't. Browsers send `Sec-Fetch-Dest: worker` when loading a
worker script, which you can match on.

nginx:

```nginx
map $http_sec_fetch_dest $csp {
  worker  "<WORKER_CSP from src/sw/headers.js>";
  default "<CSP from src/sw/headers.js>";
}

server {
  # ...
  add_header Cross-Origin-Opener-Policy same-origin always;
  add_header Cross-Origin-Embedder-Policy require-corp always;
  add_header Content-Security-Policy $csp always;

  location /wasm/ { add_header Cache-Control "public, max-age=31536000, immutable" always; }
  location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable" always; }
}
```

`add_header` inside a `location` replaces the server-level headers, so repeat
the three security headers there, or use an `include`.

## Caching

- `assets/` and `wasm/` are content-hashed or versioned; cache them for a year.
- `index.html`, `sw.js` and `manifest.webmanifest` must be revalidated on every
  visit (the default on most hosts) so updates reach users.

When you deploy a new build, the service worker's cache name changes; returning
visitors get the new app on their next load and the old copy is deleted.
Downloaded engines are kept across updates until their version changes.

## GitHub Pages

GitHub Pages can't send headers, which is what the service worker is for. Build
with `BASE_PATH` set to `/<repository>/` (or `/` for a user site or a custom
domain) and publish `dist/`, for example with the official
`actions/upload-pages-artifact` and `actions/deploy-pages` actions.

## Installing and "Open with"

The site is an installable app. In Chromium-based browsers an installed copy
appears in the operating system's "Open with" menu for the image, audio, video
and subtitle formats it reads, and on Android in the share sheet. Both need the
service worker, so they work on any host that serves the build over HTTPS.

## Checking a deployment

Open the site, then the browser console:

```js
crossOriginIsolated; // true
```

If it stays `false` after a reload, the service worker isn't running: check
that `sw.js` is served from the same directory as `index.html` and with a
JavaScript MIME type.
