import { expect, test } from '@playwright/test';

// The demo works on the live site with no account, pairing or backend: simulated audio and scenarios in the browser.
test('anyone can try the demo from the landing page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Try the demo' }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await page.getByRole('button', { name: 'Start monitoring' }).click();
  await expect(page.getByTestId('assessment')).toHaveText(/Normal/, { timeout: 10_000 });
  await page.getByLabel('Simulation scenario').selectOption('anomaly');
  await expect(page.getByRole('alert').filter({ hasText: 'Persistent acoustic anomaly' })).toBeVisible({ timeout: 12_000 });
});

test('the demo keeps your workspace one click away, and adding stays available', async ({ page }) => {
  await page.goto('/signin');
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('button', { name: 'Add device' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add member' })).toBeVisible();

  await page.getByRole('link', { name: /^Demo/ }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: /Guest workspace/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText('Nothing is kept')).toBeVisible();
});

test('listening with this browser keeps the workspace: Add device still works', async ({ page }) => {
  await page.goto('/signin');
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await page.getByRole('button', { name: 'Add device' }).click();
  await page.getByRole('dialog', { name: 'Add a device' }).getByRole('button', { name: 'Or listen with this browser' }).click();
  await expect(page.getByText('This browser is listening')).toBeVisible();
  await expect(page.getByText(/Dev scorer/i)).toHaveCount(0);

  await page.getByRole('button', { name: 'Add device' }).click(); // back to managing, pop-up open
  await expect(page.getByRole('dialog', { name: 'Add a device' }).getByLabel(/Pairing code/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('list', { name: /^Devices in / }).getByText('This browser')).toBeVisible();
});
