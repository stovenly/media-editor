import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { NATIVE } from '../../playwright.config';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'generated');

test('zooming in shows full-resolution pixels from the original', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(NATIVE);
  await page.locator('input[type=file][multiple]').setInputFiles({
    name: 'stripes.png',
    mimeType: 'image/png',
    buffer: readFileSync(join(FIXTURES, 'stripes.png')),
  });
  await page.getByRole('button', { name: 'Edit stripes.png' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('4000×3000')).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole('button', { name: /Show at 100%/ })).toHaveText(/^Fit · /);

  await page.keyboard.press('0');
  await expect(dialog.getByRole('button', { name: /Fit to the window/ })).toHaveText('100%');
  const sharp = dialog.locator('canvas.pointer-events-none');
  await expect(sharp).toBeVisible({ timeout: 30_000 });

  // The stripes are one pixel wide, so the downscaled preview is grey and only the original has 0 and 255.
  const extremes = await sharp.evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, Math.min(64, canvas.width), 1);
    let low = 255;
    let high = 0;
    for (let i = 0; i < data.length; i += 4) {
      low = Math.min(low, data[i]!);
      high = Math.max(high, data[i]!);
    }
    return { low, high };
  });
  expect(extremes.low).toBeLessThan(20);
  expect(extremes.high).toBeGreaterThan(235);

  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await expect(dialog.getByRole('button', { name: /Show at 100%/ })).toHaveText(/^Fit · /);
  await expect(sharp).toBeHidden();
});
