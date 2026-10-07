import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { NATIVE } from '../../playwright.config';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'generated');

test.describe.configure({ timeout: 120_000 });

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(NATIVE);
  await page.locator('input[type=file][multiple]').setInputFiles(
    ['tone.wav', 'tone.mp3', 'tone.wma'].map((name) => ({
      name,
      mimeType: 'application/octet-stream',
      buffer: readFileSync(join(FIXTURES, name)),
    })),
  );
  await page.getByRole('button', { name: 'Edit tone.wav' }).click();
  await expect(page.getByRole('application', { name: /Timeline/ })).toBeVisible({
    timeout: 30_000,
  });
  return errors;
}

async function exportAs(page: Page, label: string): Promise<Buffer> {
  await page.getByRole('combobox', { name: 'Export format' }).selectOption({ label });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.getByRole('button', { name: /^Download / });
  await expect(download).toBeVisible({ timeout: 90_000 });
  const [file] = await Promise.all([page.waitForEvent('download'), download.click()]);
  return readFileSync(await file.path());
}

test('joins, splits and exports audio', async ({ page }) => {
  const errors = await open(page);
  const clock = page.locator('span.font-mono');
  await expect(clock).toHaveText(/\/ 0:02\.0$/);
  await page
    .getByRole('button', { name: /^Join .* at the end$/ })
    .first()
    .click();
  await expect(clock).toHaveText(/\/ 0:04\.0$/);
  await page
    .getByRole('button', { name: /on a new track at the playhead$/ })
    .last()
    .click();
  await expect(page.getByText(/Preparing tone\.wma/)).toBeHidden({ timeout: 60_000 });

  await page.getByRole('button', { name: /Split/ }).click();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');

  const mp3 = await exportAs(page, 'MP3');
  expect(mp3.subarray(0, 3).toString() === 'ID3' || mp3[0] === 0xff).toBe(true);
  const ogg = await exportAs(page, 'Ogg Vorbis');
  expect(ogg.subarray(0, 4).toString()).toBe('OggS');
  expect(errors).toEqual([]);
});

test('plays from the playhead', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit has no way to mute test audio');
  const errors = await open(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('span.font-mono')).not.toHaveText(/^0:00\.0/, { timeout: 10_000 });
  expect(errors).toEqual([]);
});
