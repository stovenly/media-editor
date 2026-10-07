import { expect, test, type Page } from '@playwright/test';
import { NATIVE, PLAIN } from '../../playwright.config';

async function trackViolations(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.exposeFunction('reportViolation', (text: string) => violations.push(text));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { reportViolation: (text: string) => void }).reportViolation(
        `${event.violatedDirective} ${event.blockedURI}`,
      );
    });
  });
  return violations;
}

const isolated = (page: Page) =>
  page.waitForFunction(() => window.crossOriginIsolated, null, { timeout: 15_000 });

test('is isolated and violates no CSP directive where the host sends headers', async ({ page }) => {
  const violations = await trackViolations(page);
  await page.goto(NATIVE);
  await expect(page.getByText('Media Editor')).toBeVisible();
  await isolated(page);
  expect(violations).toEqual([]);
});

test('becomes isolated through the service worker where the host sends no headers', async ({
  page,
}) => {
  const violations = await trackViolations(page);
  await page.goto(PLAIN);
  await isolated(page);
  // The page reloads itself once the service worker takes control, which is slow under a loaded test run.
  await expect(page.getByText('Media Editor')).toBeVisible({ timeout: 20_000 });
  expect(violations).toEqual([]);
});

test('works offline and stays isolated', async ({ page, context, browserName }) => {
  test.fixme(
    browserName === 'webkit',
    'Playwright WebKit on Windows fails to reload while offline',
  );
  await page.goto(PLAIN);
  await isolated(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Media Editor')).toBeVisible();
  await isolated(page);
});
