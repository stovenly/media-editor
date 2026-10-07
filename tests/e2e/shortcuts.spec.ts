import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { NATIVE } from '../../playwright.config';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'generated');

test('shows the shortcuts for the current screen', async ({ page }) => {
  await page.goto(NATIVE);
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: /Keyboard shortcuts · Converter/ });
  await expect(dialog.getByText('Add files')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('opens the file picker and converts from the keyboard', async ({ page }) => {
  await page.goto(NATIVE);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.keyboard.press('ControlOrMeta+o'),
  ]);
  await chooser.setFiles({
    name: 'gradient.jpg',
    mimeType: 'image/jpeg',
    buffer: readFileSync(join(FIXTURES, 'gradient.jpg')),
  });
  await expect(page.getByText(/· [\d.]+ (bytes|KB)/)).toBeVisible();
  await page.getByRole('radio', { name: 'PNG', exact: true }).click();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByRole('button', { name: /^Download / })).toBeVisible({ timeout: 60_000 });
});

test('rotates and flips in the image editor from the keyboard', async ({ page }) => {
  await page.goto(NATIVE);
  await page
    .locator('input[type=file][multiple]')
    .first()
    .setInputFiles({
      name: 'gradient.jpg',
      mimeType: 'image/jpeg',
      buffer: readFileSync(join(FIXTURES, 'gradient.jpg')),
    });
  await page.getByRole('button', { name: 'Edit gradient.jpg' }).click();
  await expect(page.getByText('64×48')).toBeVisible();
  await page.keyboard.press('r');
  await expect(page.getByText('48×64')).toBeVisible();
  await page.keyboard.press('f');
  await expect(page.getByRole('button', { name: 'Flip horizontally' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('?');
  await expect(
    page.getByRole('dialog', { name: /Keyboard shortcuts · Image editor/ }),
  ).toBeVisible();
});
