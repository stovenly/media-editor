import { expect, test } from '@playwright/test';
import { NATIVE } from '../../playwright.config';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const WAV = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([36, 0, 0, 0]),
  Buffer.from('WAVEfmt '),
  Buffer.from([16, 0, 0, 0]),
  Buffer.alloc(16),
]);

test('inspects picked files in a worker and names what it cannot handle', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') violations.push(message.text());
  });
  await page.goto(NATIVE);
  await page.locator('input[type=file][multiple]').setInputFiles([
    { name: 'photo.png', mimeType: 'image/png', buffer: PNG_1PX },
    { name: 'sound.wav', mimeType: 'audio/wav', buffer: WAV },
    { name: 'report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n') },
  ]);

  await expect(page.getByText('3 files', { exact: true })).toBeVisible();
  await expect(page.getByText(/PNG image · 1×1 · \d+ bytes/)).toBeVisible();
  await expect(page.getByText(/WAV audio · \d+ bytes/)).toBeVisible();
  await expect(page.getByText("Can't convert this file · PDF file")).toBeVisible();
  expect(violations).toEqual([]);

  await page.getByRole('button', { name: 'Remove report.pdf' }).click();
  await expect(page.getByText('2 files', { exact: true })).toBeVisible();
});

test('renders only the visible part of a long batch', async ({ page }) => {
  await page.goto(NATIVE);
  const many = Array.from({ length: 300 }, (_, i) => ({
    name: `photo-${i}.png`,
    mimeType: 'image/png',
    buffer: PNG_1PX,
  }));
  await page.locator('input[type=file][multiple]').setInputFiles(many);
  await expect(page.getByText('300 files', { exact: true })).toBeVisible();
  await expect(page.getByText('PNG image').first()).toBeVisible();
  expect(await page.locator('article').count()).toBeLessThan(60);
});
