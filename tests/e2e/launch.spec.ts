import { expect, test } from '@playwright/test';
import { NATIVE } from '../../playwright.config';

test('the manifest offers "Open with" and sharing for media files', async ({ page }) => {
  await page.goto(NATIVE);
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  const manifest = await (await page.request.get(new URL(href!, NATIVE).href)).json();
  const accept = manifest.file_handlers[0].accept;
  expect(accept['video/*']).toEqual(expect.arrayContaining(['.mp4', '.mkv', '.mov']));
  expect(accept['image/*']).toEqual(expect.arrayContaining(['.jpg', '.heic', '.png']));
  expect(accept['text/plain']).toEqual(expect.arrayContaining(['.srt', '.vtt', '.ass']));
  expect(manifest.share_target.params.files[0].name).toBe('files');
  for (const icon of manifest.icons)
    expect((await page.request.get(new URL(icon.src, NATIVE).href)).ok()).toBe(true);
});

test('files shared to the app open in the converter', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Service workers are off in Playwright WebKit');
  await page.goto(NATIVE);
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });
  await page.evaluate(async () => {
    const form = new FormData();
    form.append('files', new File(['1\n00:00:01,000 --> 00:00:02,000\nShared\n'], 'shared.srt'));
    await fetch('./share', { method: 'POST', body: form });
  });
  await page.goto(`${NATIVE}/?shared`);
  await expect(page.getByText('shared.srt')).toBeVisible();
  await expect(page.getByText('1 caption')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
});
