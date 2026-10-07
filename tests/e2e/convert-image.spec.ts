import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { NATIVE } from '../../playwright.config';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'generated');

async function pick(page: Page, ...names: string[]) {
  await page.locator('input[type=file][multiple]').setInputFiles(
    names.map((name) => ({
      name,
      mimeType: 'application/octet-stream',
      buffer: readFileSync(join(FIXTURES, name)),
    })),
  );
}

async function downloaded(page: Page, name: string): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: `Download ${name}` }).click(),
  ]);
  const path = await download.path();
  return readFileSync(path);
}

test.describe.configure({ timeout: 120_000 });

test('converts a transparent PNG to JPG with the suggested output', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto(NATIVE);
  await pick(page, 'alpha.png');
  await expect(page.getByRole('radio', { name: 'JPG' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Transparency will be filled')).toBeVisible();
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  const bytes = await downloaded(page, 'alpha.jpg');
  expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  expect(errors).toEqual([]);
});

test('strips location data and shows it before converting', async ({ page }) => {
  await page.goto(NATIVE);
  await pick(page, 'photo-gps.jpg');
  await expect(page.getByText('Location data found · will be removed')).toBeVisible();
  await page.getByRole('radio', { name: 'PNG' }).click();
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  const bytes = await downloaded(page, 'photo-gps.png');
  expect(bytes.toString('latin1')).not.toContain('Exif');
});

test('converts a long-tail format through the extra engine and builds a ZIP of the batch', async ({
  page,
}) => {
  await page.goto(NATIVE);
  await pick(page, 'alpha.tga', 'gradient.bmp', 'alpha.psd');
  await page.getByRole('radio', { name: 'PNG' }).click();
  await page.getByRole('button', { name: 'Convert 3 files' }).click();
  await expect(page.getByRole('button', { name: /^Download .*\.png$/ })).toHaveCount(3, {
    timeout: 90_000,
  });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download all (ZIP)' }).click(),
  ]);
  const zip = readFileSync(await download.path());
  expect(zip.subarray(0, 2).toString()).toBe('PK');
});

test('makes a favicon pack from an SVG', async ({ page }) => {
  await page.goto(NATIVE);
  await pick(page, 'shape.svg');
  await page.getByRole('radio', { name: 'Favicon pack' }).click();
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  const zip = await downloaded(page, 'shape.zip');
  for (const name of [
    'favicon.ico',
    'apple-touch-icon.png',
    'icon-512.png',
    'icon.svg',
    'manifest.webmanifest',
  ]) {
    expect(zip.includes(Buffer.from(name)), name).toBe(true);
  }
});

test('keeps every frame of an animation', async ({ page }) => {
  await page.goto(NATIVE);
  await pick(page, 'anim.gif');
  await page.getByRole('radio', { name: 'Animated WebP' }).click();
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  const webp = await downloaded(page, 'anim.webp');
  expect(webp.toString('latin1').split('ANMF').length - 1).toBe(3);
});
