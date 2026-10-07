import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { NATIVE } from '../../playwright.config';
import { subtitleTracks } from '../../src/media/subtitles';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'generated');
const W = 320;
const H = 240;

// RGB24 pixels of the frame at `seconds`, decoded by the native ffmpeg that also builds the fixtures.
function frameAt(path: string, seconds: number | null): Buffer {
  const seek = seconds === null ? [] : ['-ss', String(seconds)];
  const result = spawnSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    path,
    ...seek,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-',
  ]);
  if (result.status !== 0) throw new Error(String(result.stderr));
  return result.stdout;
}

function meanDifference(a: Buffer, b: Buffer, rows: [number, number] = [0, H]): number {
  let sum = 0;
  let count = 0;
  for (let y = rows[0]; y < rows[1]; y++)
    for (let i = y * W * 3; i < (y + 1) * W * 3; i++) {
      sum += Math.abs(a[i]! - b[i]!);
      count++;
    }
  return sum / count;
}

async function download(page: Page, button: ReturnType<Page['getByRole']>) {
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  return file.path();
}

for (const container of ['MP4', 'WebM'] as const) {
  test(`burned-in text and captions in ${container} match the saved frame`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName === 'webkit', 'Exports need encoders WebKit lacks here');
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(NATIVE);
    await page.locator('input[type=file][multiple]').setInputFiles(
      ['clip.mp4', 'captions.srt'].map((name) => ({
        name,
        mimeType: 'application/octet-stream',
        buffer: readFileSync(join(FIXTURES, name)),
      })),
    );
    await page.getByRole('button', { name: 'Edit clip.mp4' }).click();
    await expect(page.getByRole('application', { name: /Video timeline/ })).toBeVisible({
      timeout: 30_000,
    });
    const clock = page.locator('span.font-mono.tabular-nums').first();

    await page.getByRole('button', { name: 'Add captions.srt as captions' }).click();
    await expect(page.getByRole('list', { name: 'Captions' }).getByRole('button')).toHaveCount(2);
    await page.getByRole('button', { name: /^Text$/ }).click();
    await page.getByRole('textbox', { name: 'Text', exact: true }).fill('HELLO');
    await page.getByRole('button', { name: 'Top', exact: true }).click();
    await page.getByLabel('Also add a subtitle track').check();
    await page.getByPlaceholder('eng').last().fill('eng');
    await page.getByPlaceholder('eng').last().blur();

    await page.getByRole('application', { name: /Video timeline/ }).focus();
    for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
    await expect(clock).toHaveText(/^0:00\.50/);
    const still = frameAt(
      await download(page, page.getByRole('button', { name: 'Save frame' })),
      null,
    );

    await page
      .getByRole('combobox', { name: 'Export format' })
      .selectOption(container === 'MP4' ? 'mp4' : 'webm');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const exported = await download(page, page.getByRole('button', { name: /^Download / }));
    const plain = frameAt(join(FIXTURES, 'clip.mp4'), 0.5);
    const near = [0.4333, 0.4667, 0.5, 0.5333, 0.5667].map((t) =>
      meanDifference(frameAt(exported, t), still),
    );

    expect(Math.min(...near)).toBe(near[2]);
    expect(near[2]).toBeLessThan(10);
    expect(meanDifference(still, plain, [0, 50])).toBeGreaterThan(10);
    expect(meanDifference(still, plain, [H - 50, H])).toBeGreaterThan(10);

    const tracks = await subtitleTracks(new Blob([readFileSync(exported)]));
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.codec).toBe(container === 'MP4' ? 'tx3g' : 'D_WEBVTT/SUBTITLES');
    expect(errors).toEqual([]);
  });
}
