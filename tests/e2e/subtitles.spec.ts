import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { NATIVE } from '../../playwright.config';
import { parseSubtitles } from '../../src/captions/cues';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'generated');

test.describe.configure({ timeout: 180_000 });

type Upload = { name: string; buffer: Buffer };

// Remuxing can shift every stream by the audio codec's start padding, a few milliseconds.
function expectCaptions(text: string) {
  const cues = parseSubtitles(text);
  expect(cues.map((c) => c.text)).toEqual(['First caption', 'Second, with\ntwo lines']);
  expect(cues[0]!.start).toBeCloseTo(0.2, 1);
  expect(cues[1]!.end).toBeCloseTo(1.8, 1);
}

const fixture = (name: string): Upload => ({ name, buffer: readFileSync(join(FIXTURES, name)) });

async function upload(page: Page, uploads: Upload[]) {
  await page.goto(NATIVE);
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles(uploads.map((u) => ({ ...u, mimeType: 'application/octet-stream' })));
  await expect(page.getByText(/· \d+ (bytes|KB)/)).toHaveCount(uploads.length);
}

async function convertTo(page: Page, output: string): Promise<string> {
  const chip = page.getByRole('radio', { name: output, exact: true });
  if (await chip.count()) await chip.click();
  else {
    await page.getByRole('button', { name: /^More .* formats$/ }).click();
    await page.getByRole('option', { name: output }).first().click();
  }
  await page.getByRole('button', { name: 'Convert', exact: true }).click();
  const download = page.getByRole('button', { name: /^Download / });
  await expect(download).toBeVisible({ timeout: 120_000 });
  const [file] = await Promise.all([page.waitForEvent('download'), download.click()]);
  return readFileSync(await file.path(), 'utf8');
}

test('converts SRT to WebVTT', async ({ page }) => {
  await upload(page, [fixture('captions.srt')]);
  await expect(page.getByText('2 captions')).toBeVisible();
  const vtt = await convertTo(page, 'WebVTT');
  expect(vtt).toMatch(/^WEBVTT\n\n00:00:00\.200 --> 00:00:00\.900\nFirst caption/);
});

test('offers subtitle extraction only for videos that have subtitles', async ({ page }) => {
  await upload(page, [fixture('clip.mp4')]);
  await page.getByRole('button', { name: /^More .* formats$/ }).click();
  await expect(page.getByRole('option', { name: /^MP4/ }).first()).toBeVisible();
  await expect(page.getByRole('option', { name: /^SRT/ })).toHaveCount(0);
});

test('extracts a subtitle track from MKV', async ({ page }) => {
  await upload(page, [fixture('subs.mkv')]);
  await expect(page.getByText('1 subtitle track')).toBeVisible();
  expectCaptions(await convertTo(page, 'SRT'));
});

for (const video of ['clip.mp4', 'clip.webm', 'clip.mkv']) {
  test(`round-trips a subtitle file through ${video.split('.')[1]!.toUpperCase()}`, async ({
    page,
  }) => {
    await upload(page, [fixture(video), fixture('captions.srt')]);
    await page.getByRole('button', { name: /Add subtitles ·/ }).click();
    await page.getByPlaceholder('eng').fill('eng');
    await page.getByRole('button', { name: 'Add subtitles', exact: true }).click();
    const download = page.getByRole('button', { name: /^Download .*-subtitled\./ });
    await expect(download).toBeVisible({ timeout: 150_000 });
    const [file] = await Promise.all([page.waitForEvent('download'), download.click()]);
    const muxed = readFileSync(await file.path());

    await upload(page, [{ name: file.suggestedFilename(), buffer: muxed }]);
    await expect(page.getByText('1 subtitle track')).toBeVisible();
    expectCaptions(await convertTo(page, 'SRT'));
  });
}
