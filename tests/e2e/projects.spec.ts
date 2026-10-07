import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { NATIVE } from '../../playwright.config';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'generated');
const FONT = join(
  import.meta.dirname,
  '..',
  '..',
  'node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2',
);

test.describe.configure({ timeout: 180_000 });

type Upload = { name: string; buffer: Buffer };
const fixture = (name: string, as = name): Upload => ({
  name: as,
  buffer: readFileSync(join(FIXTURES, name)),
});

async function upload(page: Page, uploads: Upload[]) {
  await page
    .locator('input[type=file][multiple]')
    .first()
    .setInputFiles(uploads.map((u) => ({ ...u, mimeType: 'application/octet-stream' })));
}

async function saveProject(page: Page, option: RegExp): Promise<Upload> {
  await page.getByRole('button', { name: 'Save project' }).click();
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: option }).click(),
  ]);
  return { name: file.suggestedFilename(), buffer: readFileSync(await file.path()) };
}

const textClip = (page: Page) => page.getByRole('region', { name: 'Text clip' });
const timeline = (page: Page) => page.getByRole('application', { name: /Video timeline/ });
const captionList = (page: Page) =>
  page.getByRole('list', { name: 'Captions' }).getByRole('button');

async function buildVideoProject(page: Page) {
  await page.goto(NATIVE);
  await upload(page, [fixture('clip.mp4'), fixture('captions.srt')]);
  await page.getByRole('button', { name: 'Edit clip.mp4' }).click();
  await expect(timeline(page)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Add captions.srt as captions' }).click();
  await expect(captionList(page)).toHaveCount(2);
  await page.getByRole('button', { name: /^Text$/ }).click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Saved title');
  await textClip(page)
    .getByLabel('Font file', { exact: true })
    .setInputFiles({
      name: 'Headline.woff2',
      mimeType: 'font/woff2',
      buffer: readFileSync(FONT),
    });
  await expect(textClip(page).getByRole('combobox', { name: 'Font' })).toHaveValue(
    'Headline (yours)',
  );
}

// Clicks the text clip on the timeline's Text row (ruler 22 px, rows 44 px, labels 64 px).
async function selectText(page: Page) {
  await timeline(page)
    .locator('canvas')
    .click({ position: { x: 100, y: 22 + 44 * 2 + 20 } });
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('Saved title');
}

async function expectVideoProject(page: Page) {
  await expect(timeline(page)).toBeVisible({ timeout: 60_000 });
  await expect(captionList(page)).toHaveCount(2);
  await expect(page.locator('span.font-mono.tabular-nums').first()).toHaveText(/\/ 0:03\.00$/);
}

test('reopens a video project file with renamed media', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Video editing needs WebCodecs encoders');
  await buildVideoProject(page);
  const saved = await saveProject(page, /^Project file/);
  expect(saved.name).toBe('clip.mediaproject.json');
  const json = JSON.parse(saved.buffer.toString('utf8'));
  expect(json.kind).toBe('video');
  expect(json.project.texts[0].text).toBe('Saved title');

  await page.goto(NATIVE);
  await upload(page, [saved]);
  const dialog = page.getByRole('dialog', { name: /Open project/ });
  await expect(dialog.getByText('clip.mp4')).toBeVisible();
  await expect(dialog.getByText(/Fonts this project uses: Headline\.woff2/)).toBeVisible();
  await dialog.getByLabel('Project media files').setInputFiles({
    name: 'renamed.mp4',
    mimeType: 'video/mp4',
    buffer: readFileSync(join(FIXTURES, 'clip.mp4')),
  });
  await expectVideoProject(page);
  await selectText(page);
});

test('reopens a video project bundle with its media and font', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Video editing needs WebCodecs encoders');
  await buildVideoProject(page);
  const bundle = await saveProject(page, /^Project with media/);
  expect(bundle.name).toBe('clip.mediaproject.zip');

  await page.goto(NATIVE);
  await upload(page, [bundle]);
  await expectVideoProject(page);
  await selectText(page);
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('Saved title');
  await expect(textClip(page).getByRole('combobox', { name: 'Font' })).toHaveValue(
    'Headline (yours)',
  );
});

test('reopens an audio project', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Audio export needs WebCodecs encoders');
  await page.goto(NATIVE);
  await upload(page, [fixture('tone.wav'), fixture('tone.mp3')]);
  await page.getByRole('button', { name: 'Edit tone.wav' }).click();
  await page.getByRole('button', { name: 'Join tone.mp3 at the end' }).click();
  const clock = page.locator('span.font-mono.tabular-nums').first();
  await expect(clock).toHaveText(/\/ 0:0[34]\.\d$/, { timeout: 30_000 });
  const total = await clock.textContent();
  const saved = await saveProject(page, /^Project file/);

  await page.goto(NATIVE);
  await upload(page, [saved, fixture('tone.wav'), fixture('tone.mp3')]);
  await expect(page.locator('span.font-mono.tabular-nums').first()).toHaveText(total!, {
    timeout: 30_000,
  });
});

test('reopens an image project with its edit', async ({ page }) => {
  await page.goto(NATIVE);
  await upload(page, [fixture('gradient.jpg')]);
  await page.getByRole('button', { name: 'Edit gradient.jpg' }).click();
  await page.getByRole('button', { name: 'Rotate right' }).click();
  await expect(page.getByText('48×64')).toBeVisible();
  const saved = await saveProject(page, /^Project file/);

  await page.goto(NATIVE);
  await upload(page, [fixture('gradient.jpg', 'other-name.jpg'), saved]);
  await expect(page.getByText('48×64')).toBeVisible({ timeout: 30_000 });
});
