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

async function forward(page: Page, frames: number) {
  for (let i = 0; i < frames; i++) await page.getByRole('button', { name: 'Next frame' }).click();
}

async function open(page: Page, name: string) {
  await page.goto(NATIVE);
  await page.locator('input[type=file][multiple]').setInputFiles({
    name,
    mimeType: 'video/mp4',
    buffer: readFileSync(join(FIXTURES, name)),
  });
  await page.getByRole('button', { name: `Edit ${name}` }).click();
  const clock = page.locator('span.font-mono.tabular-nums').first();
  await expect(clock).toHaveText(/\/ 0:02\.00$/, { timeout: 30_000 });
  // Timeline layout: 100 px of labels, 30 px per second, main row centred at 44 px.
  const timeline = page.getByRole('application', { name: /Video timeline/ });
  await timeline.scrollIntoViewIfNeeded();
  const box = (await timeline.locator('canvas').boundingBox())!;
  return { clock, at: (seconds: number) => ({ x: box.x + 100 + seconds * 30, y: box.y + 44 }) };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

async function exported(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const button = page.getByRole('button', { name: /^Download / });
  await expect(button).toBeVisible({ timeout: 60_000 });
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  return file.path();
}

test('cuts on key frames export by copying', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Video editing needs WebCodecs');
  test.setTimeout(120_000);
  const { clock, at } = await open(page, 'keyed.mp4');

  // Key frames are every 0.4 s: keep 0–0.8 s and 1.2–2 s.
  const split = page.getByRole('button', { name: 'Split', exact: true });
  await forward(page, 24);
  await split.click();
  await forward(page, 12);
  await split.click();
  await page.mouse.click(at(1).x, at(1).y);
  await page.keyboard.press('Delete');
  await drag(page, at(1.6), at(1.2));
  await expect(clock).toHaveText(/\/ 0:01\.60$/);

  await expect(page.getByRole('radio', { name: 'Fast', exact: true })).toBeChecked();
  const path = await exported(page);
  await expect(
    page.getByText('Copied without re-encoding, so there is no quality loss'),
  ).toBeVisible();
  const info = probe(path);
  expect(Number(info.format.duration)).toBeCloseTo(1.6, 1);
  expect(info.streams.map((s) => s.codec_name).sort()).toEqual(['aac', 'h264']);
  const source = join(FIXTURES, 'keyed.mp4');
  expect(meanDifference(frameAt(path, 0.5), frameAt(source, 0.5))).toBeLessThan(0.5);
  expect(meanDifference(frameAt(path, 1.0), frameAt(source, 1.4))).toBeLessThan(0.5);
});

test('a trim between key frames is re-encoded to land exactly', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Video editing needs WebCodecs');
  test.setTimeout(120_000);
  const { clock, at } = await open(page, 'clip.mp4');
  await drag(page, { x: at(0).x + 1, y: at(0).y }, at(1));
  await expect(clock).toHaveText(/\/ 0:02\.00$/);

  await expect(page.getByRole('radio', { name: 'Fast', exact: true })).toBeChecked();
  const path = await exported(page);
  await expect(page.getByText(/Re-encoded so the cuts land exactly/)).toBeVisible();
  expect(Number(probe(path).format.duration)).toBeCloseTo(1, 1);
  const source = join(FIXTURES, 'clip.mp4');
  const first = frameAt(path, 0.2);
  expect(meanDifference(first, frameAt(source, 1.2))).toBeLessThan(
    meanDifference(first, frameAt(source, 0.2)) * 0.75,
  );
});
