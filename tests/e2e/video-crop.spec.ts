import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { NATIVE } from '../../playwright.config';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'generated');

// Mean brightness (0..255) of the top rows of a PNG, decoded by the native ffmpeg.
function topBrightness(path: string, rows: number): number {
  const rgb = spawnSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    path,
    '-vf',
    `crop=iw:${rows}:0:0`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'gray',
    '-',
  ]).stdout;
  return rgb.reduce((sum, v) => sum + v, 0) / rgb.length;
}

test('crops a clip to fill a different frame shape', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Video editing needs WebCodecs');
  await page.goto(NATIVE);
  await page.locator('input[type=file][multiple]').setInputFiles({
    name: 'clip.mp4',
    mimeType: 'video/mp4',
    buffer: readFileSync(join(FIXTURES, 'clip.mp4')),
  });
  await page.getByRole('button', { name: 'Edit clip.mp4' }).click();
  await expect(page.getByRole('application', { name: /Video timeline/ })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('combobox', { name: 'Shape', exact: true }).selectOption('1:1');
  const save = async () => {
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Save frame' }).click(),
    ]);
    return file.path();
  };
  expect(topBrightness(await save(), 100)).toBeLessThan(2);

  await page.keyboard.press(']');
  await page.getByRole('button', { name: 'Fill the frame' }).click();
  await expect(page.getByText('75% × 100%')).toBeVisible();
  expect(topBrightness(await save(), 100)).toBeGreaterThan(20);

  await page.getByRole('button', { name: 'Crop on the preview' }).click();
  const area = page.getByRole('slider', { name: /Crop area/ });
  const before = Number(await area.getAttribute('aria-valuenow'));
  await area.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(area).not.toHaveAttribute('aria-valuenow', String(before));
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(area).toBeHidden();
});
