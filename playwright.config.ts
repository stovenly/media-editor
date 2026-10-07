import { defineConfig, devices } from '@playwright/test';

export const NATIVE = 'http://localhost:4173';
export const PLAIN = 'http://localhost:4174';

// Playback tests produce real sound; keep every browser silent.
const chromiumSilent = { launchOptions: { args: ['--mute-audio'] } };
const firefoxSilent = { launchOptions: { firefoxUserPrefs: { 'media.volume_scale': '0.0' } } };

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...chromiumSilent },
      grepInvert: /@perf/,
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], ...firefoxSilent },
      grepInvert: /@perf/,
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
