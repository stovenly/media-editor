import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { NATIVE } from '../../playwright.config';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'generated');

test('drags the edge of a text clip to make it longer', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Video editing needs WebCodecs');
  await page.goto(NATIVE);
  await page.locator('input[type=file][multiple]').setInputFiles({
    name: 'clip.mp4',
    mimeType: 'video/mp4',
    buffer: readFileSync(join(FIXTURES, 'clip.mp4')),
  });
  await page.getByRole('button', { name: 'Edit clip.mp4' }).click();
  const timeline = page.getByRole('application', { name: /Video timeline/ });
  await expect(timeline).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /^Text$/ }).click();
  const lasts = page.getByRole('spinbutton', { name: 'Lasts', exact: true });
  await expect(lasts).toHaveValue('0:03.00');

  // Timeline layout: 100 px of labels, 30 px per second, new text sits on the top layer, centred at 44 px.
  await timeline.scrollIntoViewIfNeeded();
  const box = (await timeline.locator('canvas').boundingBox())!;
  const y = box.y + 44;
  await page.mouse.move(box.x + 100 + 90, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 100 + 180, y, { steps: 5 });
  await page.mouse.up();
  await expect(lasts).toHaveValue('0:06.00');

  await page.mouse.move(box.x + 100, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 100 + 60, y, { steps: 5 });
  await page.mouse.up();
  await expect(lasts).toHaveValue('0:04.00');
  await expect(page.getByRole('spinbutton', { name: 'Starts at', exact: true })).toHaveValue(
    '0:02.00',
  );
});

test('snaps a dragged edge to the edge of another item', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Video editing needs WebCodecs');
  await page.goto(NATIVE);
  await page.locator('input[type=file][multiple]').setInputFiles({
    name: 'clip.mp4',
    mimeType: 'video/mp4',
    buffer: readFileSync(join(FIXTURES, 'clip.mp4')),
  });
  await page.getByRole('button', { name: 'Edit clip.mp4' }).click();
  const timeline = page.getByRole('application', { name: /Video timeline/ });
  await expect(timeline).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /^Text$/ }).click();
  const lasts = page.getByRole('spinbutton', { name: 'Lasts', exact: true });
  await expect(lasts).toHaveValue('0:03.00');

  // The video clip ends at 2 s (124 px); letting go 4 px past it lands exactly on it.
  await timeline.scrollIntoViewIfNeeded();
  const box = (await timeline.locator('canvas').boundingBox())!;
  const y = box.y + 44;
  await page.mouse.move(box.x + 100 + 90, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 100 + 64, y, { steps: 5 });
  await page.mouse.up();
  await expect(lasts).toHaveValue('0:02.00');
});
