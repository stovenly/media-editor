import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { NATIVE } from '../../playwright.config';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'generated');

test.describe.configure({ timeout: 120_000 });

async function convert(page: Page, name: string, output: string): Promise<Buffer> {
  await page.goto(NATIVE);
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles([
      { name, mimeType: 'application/octet-stream', buffer: readFileSync(join(FIXTURES, name)) },
    ]);
  const chip = page.getByRole('radio', { name: output, exact: true });
  await expect(page.getByText(/· \d+ (bytes|KB)/)).toBeVisible();
  if (await chip.count()) await chip.click();
  else {
    await page.getByRole('button', { name: /^More .* formats$/ }).click();
    await page.getByRole('option', { name: output }).first().click();
  }
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  const download = page.getByRole('button', { name: /^Download / });
  await expect(download).toBeVisible({ timeout: 90_000 });
  const [file] = await Promise.all([page.waitForEvent('download'), download.click()]);
  return readFileSync(await file.path());
}

const ascii = (bytes: Buffer, from: number, to: number) =>
  bytes.subarray(from, to).toString('latin1');

test('converts MP4 to WebM natively', async ({ page }) => {
  const webm = await convert(page, 'clip.mp4', 'WebM');
  expect([...webm.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
});

test('extracts MP3 audio from a video', async ({ page }) => {
  const mp3 = await convert(page, 'clip.mp4', 'MP3');
  expect(ascii(mp3, 0, 3) === 'ID3' || (mp3[0] === 0xff && (mp3[1]! & 0xe0) === 0xe0)).toBe(true);
});

test('falls back to FFmpeg for AVI input', async ({ page }) => {
  const mp4 = await convert(page, 'clip.avi', 'MP4');
  expect(ascii(mp4, 4, 8)).toBe('ftyp');
});

test('turns a video into an animated GIF', async ({ page }) => {
  const gif = await convert(page, 'clip.mp4', 'Animated GIF');
  expect(ascii(gif, 0, 6)).toBe('GIF89a');
});

test('removes the location tag from a video', async ({ page }) => {
  await page.goto(NATIVE);
  const mp4 = await convert(page, 'clip.mp4', 'MOV');
  expect(mp4.includes(Buffer.from('+51.5000'))).toBe(false);
});

test('converts WAV to FLAC', async ({ page }) => {
  const flac = await convert(page, 'tone.wav', 'FLAC');
  expect(ascii(flac, 0, 4)).toBe('fLaC');
});

test('fits an animated GIF to a file size, with progress all the way', async ({ page }) => {
  const full = await convert(page, 'long.mp4', 'Animated GIF');
  const target = (full.length * 0.4) / 1_000_000;

  await page.getByRole('button', { name: 'Clear all' }).click();
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles([
      { name: 'long.mp4', mimeType: 'video/mp4', buffer: readFileSync(join(FIXTURES, 'long.mp4')) },
    ]);
  await page.getByRole('radio', { name: 'Animated GIF', exact: true }).click();
  const custom = page.getByPlaceholder('Custom');
  await custom.fill(target.toFixed(3));
  await custom.blur();
  await page.getByRole('button', { name: 'Convert', exact: true }).click();

  const seen = new Set<number>();
  const download = page.getByRole('button', { name: /^Download / });
  while (!(await download.isVisible())) {
    const text = await page
      .locator('article')
      .getByText(/^\d+%/)
      .textContent()
      .catch(() => null);
    if (text) seen.add(Number.parseInt(text, 10));
    await page.waitForTimeout(50);
  }
  expect([...seen].some((p) => p >= 20 && p <= 80)).toBe(true);
  await expect(page.getByText(/Made \d+ px wide/)).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent('download'), download.click()]);
  const gif = readFileSync(await file.path());
  expect(ascii(gif, 0, 6)).toBe('GIF89a');
  expect(gif.length).toBeLessThanOrEqual(target * 1_000_000);
});
