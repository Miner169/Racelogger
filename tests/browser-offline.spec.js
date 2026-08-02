// Playwright end-to-end specification. Install Playwright in a CI runner, serve
// the package over HTTPS or localhost, and set BASE_URL before execution.
const { test, expect } = require('@playwright/test');
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8765/index.html';

test('v19.3.3 entry and command controls load without runtime errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await expect(page.locator('#recoveryWizard')).toBeAttached();
  await expect(page.locator('#reconciliationView')).toBeAttached();
  await expect(page.locator('#v19DecisionModal')).toBeAttached();
  await expect(page.locator('#widget-heatmap')).toBeAttached();
  await expect(page.locator('#widget-cot-funnel')).toBeAttached();
  await expect(page.locator('#minimalNativeBibInput')).toBeAttached();
  await expect(page.locator('#widget-post-race-report')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('recovery and reconciliation surfaces open and close', async ({ page }) => {
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => openRecoveryWizard_());
  await expect(page.locator('#recoveryWizard')).toBeVisible();
  await page.evaluate(() => closeRecoveryWizard_());
  await expect(page.locator('#recoveryWizard')).toBeHidden();
  await page.evaluate(() => openReconciliationScreen_());
  await expect(page.locator('#reconciliationView')).toBeVisible();
});

test('app shell remains available after network is disabled', async ({ page, context }) => {
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toContainText(/Race|BIB/i);
});
