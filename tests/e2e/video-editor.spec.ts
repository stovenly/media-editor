import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { NATIVE } from '../../playwright.config';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'generated');

test('joins clips, adds an overlay and music, and exports MP4', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit has no way to mute test audio');
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(NATIVE);
  await page.locator('input[type=file][multiple]').setInputFiles(
    ['clip.mp4', 'clip.webm', 'clip.avi', 'alpha.png', 'tone.mp3'].map((name) => ({
      name,
      mimeType: 'application/octet-stream',
      buffer: readFileSync(join(FIXTURES, name)),
    })),
  );
  await page.getByRole('button', { name: 'Edit clip.mp4' }).click();
  await expect(page.getByRole('application', { name: /Video timeline/ })).toBeVisible({
    timeout: 30_000,
  });
  const clock = page.locator('span.font-mono.tabular-nums');
  await expect(clock).toHaveText(/\/ 0:02\.00$/);

  await page.getByRole('button', { name: 'Add clip.webm to the video track' }).click();
  await expect(clock).toHaveText(/\/ 0:04\.0\d$/);
  await page.getByRole('button', { name: 'Add clip.avi to the video track' }).click();
  await expect(clock).toHaveText(/\/ 0:06\.0\d$/, { timeout: 90_000 });
  await page.getByRole('button', { name: 'Add alpha.png as an overlay' }).click();
  await page.getByRole('button', { name: 'Add tone.mp3 as music' }).click();

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(clock).not.toHaveText(/^0:00\.00/, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.getByRole('button', { name: /^Download / });
  await expect(download).toBeVisible({ timeout: 120_000 });
  const [file] = await Promise.all([page.waitForEvent('download'), download.click()]);
  const bytes = readFileSync(await file.path());
  expect(bytes.subarray(4, 8).toString()).toBe('ftyp');
  expect(errors).toEqual([]);
});
