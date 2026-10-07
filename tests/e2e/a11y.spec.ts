import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { NATIVE } from '../../playwright.config';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'generated');

test.describe.configure({ timeout: 120_000 });

// `within` scopes an audit to an overlay, so controls it covers aren't reported as too small.
async function audit(page: Page, screen: string, within?: string) {
  const builder = new AxeBuilder({ page });
  if (within) {
    await expect(page.locator(within).first()).toBeVisible();
    builder.include(within);
  }
  const results = await builder
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const found = results.violations.map(
    (v) => `${screen}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
  expect(found).toEqual([]);
}

async function upload(page: Page, names: string[]) {
  await page
    .locator('input[type=file][multiple]')
    .first()
    .setInputFiles(
      names.map((name) => ({
        name,
        mimeType: 'application/octet-stream',
        buffer: readFileSync(join(FIXTURES, name)),
      })),
    );
  await expect(page.getByText(/· [\d.]+ (bytes|KB)/)).toHaveCount(names.length, {
    timeout: 30_000,
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test('converter', async ({ page }) => {
      await page.goto(NATIVE);
      await audit(page, 'empty converter');
      await upload(page, ['gradient.jpg', 'alpha.png', 'clip.mp4', 'tone.mp3', 'captions.srt']);
      await page.getByRole('button', { name: /^Options/ }).click();
      await page.getByRole('button', { name: /^Combine/ }).click();
      await page.getByRole('button', { name: /^Add subtitles ·/ }).click();
      await audit(page, 'converter with files');
      await page
        .getByRole('button', { name: /^More .* formats$/ })
        .first()
        .click();
      await audit(page, 'format menu', '[data-popover-content]');
      await page.keyboard.press('Escape');
      await page.keyboard.press('?');
      await audit(page, 'shortcuts dialog', '[role=dialog]');
    });

    test('image editor', async ({ page }) => {
      await page.goto(NATIVE);
      await upload(page, ['gradient.jpg']);
      await page.getByRole('button', { name: 'Edit gradient.jpg' }).click();
      await expect(page.getByText('64×48')).toBeVisible();
      await audit(page, 'image editor');
    });

    test('audio editor', async ({ page }) => {
      await page.goto(NATIVE);
      await upload(page, ['tone.wav', 'tone.mp3']);
      await page.getByRole('button', { name: 'Edit tone.wav' }).click();
      await expect(page.getByRole('button', { name: 'Join tone.mp3 at the end' })).toBeVisible({
        timeout: 30_000,
      });
      await audit(page, 'audio editor');
    });

    test('video editor', async ({ page, browserName }) => {
      test.skip(browserName === 'webkit', 'Video editing needs WebCodecs');
      await page.goto(NATIVE);
      await upload(page, ['clip.mp4', 'captions.srt']);
      await page.getByRole('button', { name: 'Edit clip.mp4' }).click();
      await expect(page.getByRole('application', { name: /Video timeline/ })).toBeVisible({
        timeout: 30_000,
      });
      await page.getByRole('button', { name: 'Add captions.srt as captions' }).click();
      await page.getByRole('button', { name: /^Text$/ }).click();
      await audit(page, 'video editor');
    });
  });
}
