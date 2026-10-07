import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { NATIVE } from '../../playwright.config';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'generated');

test('edits an image and converts the edited result', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(NATIVE);
  await page.locator('input[type=file][multiple]').setInputFiles([
    {
      name: 'alpha.png',
      mimeType: 'image/png',
      buffer: readFileSync(join(FIXTURES, 'alpha.png')),
    },
  ]);
  await page.getByRole('button', { name: 'Edit alpha.png' }).click();
  await expect(page.getByRole('heading', { name: /Edit alpha\.png/ })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: '1:1' }).click();
  await expect(page.getByText('48×48')).toBeVisible();
  await page.getByRole('button', { name: 'Rotate right' }).click();
  await page.getByRole('button', { name: /^Undo/ }).click();
  await page.getByRole('tab', { name: /Redact/ }).click();
  const stage = page.getByRole('application', { name: /draw an area/ });
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByText('1. Solid box')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('button', { name: 'Edit alpha.png' })).toHaveAttribute(
    'title',
    'Edited',
  );
  await page.getByRole('radio', { name: 'WebP' }).click();
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(page.getByText(/Redacted, with all metadata/)).toBeVisible({ timeout: 60_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download alpha.webp' }).click(),
  ]);
  const bytes = readFileSync(await download.path());
  expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
});
