import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

export default ts.config(
  { ignores: ['dist/', 'public/wasm/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser,
        svelteConfig,
      },
    },
    // Large state is $state.raw replaced immutably, so plain Map/Set are intended.
    rules: { 'svelte/prefer-svelte-reactivity': 'off' },
  },
  {
    files: ['src/sw/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker, __BUILD__: 'readonly' } },
  },
  {
    files: ['src/engine/audio/ring-processor.js'],
    languageOptions: { globals: { ...globals.audioWorklet } },
  },
);
