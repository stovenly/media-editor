import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { webManifest } from './src/app/manifest.ts';
import { CSP, CSP_META, cspFor, ISOLATION, WORKER_CSP } from './src/sw/headers.js';

// Large encoders each worker bundles its own copy of; cached when first used rather than at install.
const ON_DEMAND = /(mediabunny-(aac|flac|mp3)-encoder|gifski_wasm_bg)-[\w-]+\.(js|wasm)$/;

// Emits sw.js with the header policy and the hashed app-shell file list baked
// in, and puts the CSP in a <meta> for the first, uncontrolled load.
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP_META },
        injectTo: 'head-prepend',
      },
    ],
    generateBundle(_options, bundle) {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: webManifest() });
      for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES'])
        this.emitFile({
          type: 'asset',
          fileName: `${file}.txt`,
          source: readFileSync(file, 'utf8'),
        });
      const bundled = Object.keys(bundle).filter(
        (name) => !name.endsWith('.map') && !ON_DEMAND.test(name),
      );
      const shell = [
        ...new Set(['index.html', 'manifest.webmanifest', ...bundled, ...publicFiles()]),
      ];
      const version = createHash('sha256').update(shell.join('\n')).digest('hex').slice(0, 12);
      const engines = Object.values(
        JSON.parse(readFileSync('public/wasm/manifest.json', 'utf8')) as Record<
          string,
          { dir: string }
        >,
      ).map((engine) => engine.dir);
      const build = {
        version,
        shell,
        engines,
        headers: ISOLATION,
        csp: CSP,
        workerCsp: WORKER_CSP,
      };
      const source = readFileSync('src/sw/sw.js', 'utf8').replace(
        'const BUILD = __BUILD__;',
        `const BUILD = ${JSON.stringify(build)};`,
      );
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// Links the web app manifest, which the build emits and the dev server serves.
function manifest(): Plugin {
  let base = '/';
  return {
    name: 'web-manifest',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'manifest', href: `${base}manifest.webmanifest` } },
      { tag: 'meta', attrs: { name: 'theme-color', content: '#4f46e5' } },
    ],
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.endsWith('/manifest.webmanifest')) return next();
        response.setHeader('Content-Type', 'application/manifest+json');
        response.end(webManifest());
      });
    },
  };
}

// Sends the policy per request, because worker scripts get a different one from documents.
function previewCsp(): Plugin {
  return {
    name: 'preview-csp',
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        response.setHeader('Content-Security-Policy', cspFor(request.headers['sec-fetch-dest']));
        next();
      });
    },
  };
}

function publicFiles(): string[] {
  return readdirSync('public', { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [svelte(), tailwindcss(), serviceWorker(), previewCsp(), manifest()],
  server: { headers: ISOLATION },
  preview: { headers: ISOLATION },
  worker: { format: 'es' },
  build: {
    target: 'es2023',
    // Scripts loaded by URL (the AudioWorklet) must stay files: the CSP forbids data: scripts.
    assetsInlineLimit: (file) => (file.endsWith('.js') ? false : undefined),
  },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
