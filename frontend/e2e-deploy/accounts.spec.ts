import { expect, test } from '@playwright/test';

// Guest workspace → pairing code → second browser pairs and listens → the workspace console watches it.
// Needs a live backend (no Supabase account required: guest mode).
test('guest pairs a listening device with a code and watches it', async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await admin.goto('/app');
  await expect(admin).toHaveURL(/\/signin$/); // no workspace yet → sign in
  await admin.getByRole('button', { name: 'Continue as guest' }).click();
  await expect(admin).toHaveURL(/\/app$/);
  await expect(admin.getByText('Nothing is kept')).toBeVisible();
  await expect(admin.getByTestId('guest-countdown')).toHaveText(/^1:59:\d\d$/); // live countdown to deletion

  await admin.getByRole('button', { name: 'Add a device' }).click();
  const add = admin.getByRole('dialog', { name: 'Add a device' });
  await expect(add.getByRole('tab')).toHaveCount(0); // just the pairing form, not the workspace settings
  await add.getByLabel('Device name').fill('Phone at fan');
  await add.getByRole('button', { name: 'Get pairing code' }).click();
  const code = (await add.locator('p.num').first().textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await expect(add.getByRole('img', { name: /QR code/ })).toBeVisible();

  const phone = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
  await phone.goto(`/pair#code=${code}`);
  await expect(phone.locator('input')).toHaveValue(code); // filled from the QR link
  await phone.getByRole('button', { name: 'Pair device' }).click();
  await expect(phone).toHaveURL(/\/app$/);
  await phone.getByText('Microphone', { exact: true }).click();
  await phone.getByRole('button', { name: 'Start monitoring' }).click();
  await expect(phone.getByTestId('assessment')).toHaveText(/Unable to assess|Normal|Abnormal/, { timeout: 30_000 });

  await expect(add.getByText('is paired')).toBeVisible({ timeout: 15_000 });
  await add.getByRole('button', { name: 'Close panel' }).click();
  await expect(admin.getByText('listening now')).toBeVisible({ timeout: 20_000 });
  await expect(admin.getByTestId('assessment')).toHaveText(/Normal|Abnormal|Unable to assess/, { timeout: 30_000 });

  // A used code does not work twice.
  const other = await (await browser.newContext()).newPage();
  await other.goto(`/pair#code=${code}`);
  await other.getByRole('button', { name: 'Pair device' }).click();
  await expect(other.getByRole('alert')).toContainText('already used');

  // Removing the device cuts it off.
  await admin.getByRole('button', { name: 'Workspace', exact: true }).click();
  const panel = admin.getByRole('dialog', { name: 'Workspace' });
  await panel.getByRole('button', { name: 'Remove' }).click();
  await panel.getByRole('button', { name: 'Revoke' }).click();
  await expect(panel.getByText('None yet')).toBeVisible();
  await expect(phone.getByRole('status').filter({ hasText: /interrupted|Monitoring/ }).first()).toBeVisible();
  await phone.getByRole('button', { name: 'Stop monitoring' }).click();

  await admin.getByRole('tab', { name: 'Activity' }).click();
  await expect(panel.getByText('paired')).toBeVisible();
  await expect(panel.getByText('removed device')).toBeVisible();
});
