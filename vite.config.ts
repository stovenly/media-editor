import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { CSP, CSP_META, cspFor, ISOLATION, WORKER_CSP } from './src/sw/headers.js';

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
      const bundled = Object.keys(bundle).filter((name) => !name.endsWith('.map'));
      const shell = [...new Set(['index.html', ...bundled, ...publicFiles()])];
      const version = createHash('sha256').update(shell.join('\n')).digest('hex').slice(0, 12);
      const build = { version, shell, headers: ISOLATION, csp: CSP, workerCsp: WORKER_CSP };
      const source = readFileSync('src/sw/sw.js', 'utf8').replace(
        'const BUILD = __BUILD__;',
        `const BUILD = ${JSON.stringify(build)};`,
      );
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
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
  plugins: [svelte(), tailwindcss(), serviceWorker(), previewCsp()],
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
