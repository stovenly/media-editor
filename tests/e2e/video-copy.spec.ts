import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { NATIVE } from '../../playwright.config';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'generated');

function probe(path: string) {
  const result = spawnSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=codec_name',
    '-of',
    'json',
    path,
  ]);
  return JSON.parse(String(result.stdout)) as {
    format: { duration: string };
    streams: { codec_name: string }[];
  };
}

function frameAt(path: string, seconds: number): Buffer {
  return spawnSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    path,
    '-ss',
    String(seconds),
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-',
  ]).stdout;
}

const meanDifference = (a: Buffer, b: Buffer) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
};

async function seekTo(page: Page, frames: number) {
  await page.getByRole('application', { name: /Video timeline/ }).focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < frames; i++) await page.keyboard.press('ArrowRight');
}

test('cut-only edits export by copying, with cuts on key frames', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Video editing needs WebCodecs');
  test.setTimeout(120_000);
  await page.goto(NATIVE);
  await page.locator('input[type=file][multiple]').setInputFiles({
    name: 'keyed.mp4',
    mimeType: 'video/mp4',
    buffer: readFileSync(join(FIXTURES, 'keyed.mp4')),
  });
  await page.getByRole('button', { name: 'Edit keyed.mp4' }).click();
  const clock = page.locator('span.font-mono.tabular-nums').first();
  await expect(clock).toHaveText(/\/ 0:02\.00$/, { timeout: 30_000 });

  // Keep 0–0.6 s and 1.4–2 s; key frames are every 0.4 s, so the copy keeps 0–0.8 s and 1.2–2 s.
  await seekTo(page, 18);
  await page.keyboard.press('s');
  await seekTo(page, 42);
  await page.keyboard.press('s');
  await page.keyboard.press(']');
  await page.keyboard.press(']');
  await page.keyboard.press('Delete');
  await expect(clock).toHaveText(/\/ 0:01\.20$/);

  await expect(page.getByLabel(/Fast export without re-encoding/)).toBeChecked();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const button = page.getByRole('button', { name: /^Download / });
  await expect(button).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Cuts moved to the nearest key frames: 1\.60 s/)).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const path = await file.path();

  const info = probe(path);
  expect(Number(info.format.duration)).toBeCloseTo(1.6, 1);
  expect(info.streams.map((s) => s.codec_name).sort()).toEqual(['aac', 'h264']);
  const source = join(FIXTURES, 'keyed.mp4');
  expect(meanDifference(frameAt(path, 0.5), frameAt(source, 0.5))).toBeLessThan(0.5);
  expect(meanDifference(frameAt(path, 1.0), frameAt(source, 1.4))).toBeLessThan(0.5);
});
