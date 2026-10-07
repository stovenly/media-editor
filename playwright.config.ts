import { defineConfig, devices } from '@playwright/test';

export const NATIVE = 'http://localhost:4173';
export const PLAIN = 'http://localhost:4174';

// Playback tests produce real sound; keep every browser silent.
const chromiumSilent = { launchOptions: { args: ['--mute-audio'] } };
// Without a desktop to draw to (screen locked or asleep), Firefox's native compositor fails and breaks teardown.
const firefoxSilent = {
  launchOptions: {
    firefoxUserPrefs: {
      'media.volume_scale': '0.0',
      'gfx.webrender.compositor': false,
      'gfx.webrender.software.d3d11': false,
      'layers.gpu-process.enabled': false,
    },
  },
};

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  // Each test runs WebAssembly encoders on several threads; more workers than this starve the browsers.
  workers: 6,
  reporter: 'list',
  projects: [
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], ...firefoxSilent },
      grepInvert: /@perf/,
    },
    // Firefox started while Chromium is busy can hang on its first page, so Chromium waits for it.
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...chromiumSilent },
      grepInvert: /@perf/,
      dependencies: ['firefox'],
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grepInvert: /@perf/ },
    // Timing tests run alone, after everything else, so other tests don't steal the CPU.
    {
      name: 'perf',
      use: { ...devices['Desktop Chrome'], ...chromiumSilent },
      grep: /@perf/,
      dependencies: ['chromium', 'firefox'],
      fullyParallel: false,
    },
  ],
  webServer: [
    {
      command: 'npx vite preview --port 4173 --strictPort',
      url: NATIVE,
      reuseExistingServer: true,
    },
    { command: 'node scripts/serve-plain.mjs 4174', url: PLAIN, reuseExistingServer: true },
  ],
});
