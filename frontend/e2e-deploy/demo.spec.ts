import { expect, test } from '@playwright/test';

test('Try as guest on the landing page, and the old /demo link, go straight into a guest workspace', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Try as guest' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText('Nothing is kept')).toBeVisible();
  await page.goto('/demo');
  await expect(page).toHaveURL(/\/app$/);
});

test('a guest starts in an empty workspace named Workspace, with the sidebar and no Demo link', async ({ page }) => {
  await page.goto('/signin');
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('button', { name: 'Add device' })).toBeVisible();
  await expect(page.getByText('Nothing is kept')).toBeVisible();
  await expect(page.getByRole('link', { name: /^Demo/ })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Workspace', exact: true })).toBeVisible();
});

test('using this computer microphone keeps the workspace: Add device still works', async ({ page }) => {
  await page.goto('/signin');
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await page.getByRole('button', { name: 'Add device' }).click();
  await page.getByRole('dialog', { name: 'Add a device' }).getByRole('button', { name: "Use this computer's microphone" }).click();
  await expect(page.getByText("Using this computer's microphone")).toBeVisible();
  await expect(page.getByRole('list', { name: /^Devices in / }).getByText(/Chrome/)).toBeVisible(); // listed while it listens
  await expect(page.getByText(/Dev scorer/i)).toHaveCount(0);

  await page.getByRole('button', { name: 'Add device' }).click(); // back to managing, pop-up open
  await expect(page.getByRole('dialog', { name: 'Add a device' }).getByLabel(/Pairing code/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('list', { name: /^Devices in / }).getByText(/Chrome/)).toBeVisible();
});
