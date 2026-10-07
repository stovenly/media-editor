import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { NATIVE } from '../../playwright.config';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'generated');
const SHELL_BUDGET = 200 * 1000;

test('first load stays under the shell budget and fetches no engine', async ({ page }) => {
  const scripts: Buffer[] = [];
  const urls: string[] = [];
  page.on('response', async (response) => {
    urls.push(response.url());
    if (response.request().resourceType() === 'script') scripts.push(await response.body());
  });
  await page.goto(NATIVE);
  await page.waitForLoadState('networkidle');
  const gzipped = scripts.reduce((sum, body) => sum + gzipSync(body).length, 0);
  expect(gzipped).toBeLessThan(SHELL_BUDGET);
  expect(urls.filter((url) => url.includes('/wasm/'))).toEqual([]);
});

test('keeps the main thread responsive during a batch @perf', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Long Tasks API is Chromium-only');
  test.setTimeout(120_000);
  await page.goto(NATIVE);
  await page.evaluate(() => {
    (window as unknown as { longest: number }).longest = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const state = window as unknown as { longest: number };
        state.longest = Math.max(state.longest, entry.duration);
      }
    }).observe({ type: 'longtask', buffered: false });
  });
  const names = [
    'alpha.png',
    'gradient.jpg',
    'photo-gps.jpg',
    'gradient.bmp',
    'alpha.webp',
    'anim.gif',
  ];
  const files = Array.from({ length: 60 }, (_, i) => {
    const name = names[i % names.length]!;
    return {
      name: `${i}-${name}`,
      mimeType: 'application/octet-stream',
      buffer: readFileSync(join(FIXTURES, name)),
    };
  });
  await page.locator('input[type=file][multiple]').setInputFiles(files);
  await page.getByRole('radio', { name: 'WebP' }).click();
  await page.getByRole('button', { name: /^Convert \d+ files$/ }).click();
  await expect(page.getByRole('button', { name: 'Download all (ZIP)' })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByRole('button', { name: /^Convert/ })).toBeDisabled({ timeout: 90_000 });
  const longest = await page.evaluate(() => (window as unknown as { longest: number }).longest);
  expect(longest).toBeLessThan(50);
});
