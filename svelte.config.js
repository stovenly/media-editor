import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  vitePlugin: {
    // A component without runes compiles in legacy mode, which deep-reads every imported object on each update.
    /** @param {{ filename: string }} options */
    dynamicCompileOptions: ({ filename }) =>
      filename.includes('node_modules') ? undefined : { runes: true },
  },
};
