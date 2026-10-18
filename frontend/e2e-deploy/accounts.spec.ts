import { expect, test } from '@playwright/test';

// Guest workspace → pairing code → second browser pairs and listens → the workspace console watches it.
// Needs a live backend (no Supabase account required: guest mode).
test('guest pairs a listening device with a code and watches it', async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await admin.goto('/app');
  await expect(admin).toHaveURL(/\/signin$/); // no workspace yet → sign in
  await admin.getByRole('button', { name: 'Continue as guest' }).click();
  await admin.getByLabel('New workspace').fill('Guest workspace');
  await admin.getByRole('button', { name: 'Create workspace' }).click();
  await expect(admin).toHaveURL(/\/app$/);
  await expect(admin.getByText('Nothing is kept')).toBeVisible();
  await expect(admin.getByTestId('guest-countdown')).toHaveText(/^1:59:\d\d$/); // live countdown to deletion

  // One click: a pop-up with the code and QR.
  await admin.getByRole('button', { name: 'Add device' }).click();
  const add = admin.getByRole('dialog', { name: 'Add a device' });
  await expect(add.getByLabel(/Pairing code/)).toBeVisible();
  const code = (await add.locator('p.num').first().textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await expect(add.getByRole('img', { name: /QR code/ })).toBeVisible();

  const phone = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
  await phone.goto(`/pair#code=${code}`);
  await expect(phone.getByRole('textbox', { name: /Pairing code/ })).toHaveValue(code); // filled from the QR link
  await phone.getByLabel('Name for this device').fill('Phone at fan');
  await phone.getByRole('button', { name: 'Pair device' }).click();
  await expect(phone.getByText('Waiting for approval')).toBeVisible();

  // The same pop-up now asks the admin to approve it; the phone continues by itself.
  await expect(add).toContainText('Phone at fan', { timeout: 15_000 });
  await add.getByRole('button', { name: 'Approve' }).click();
  await expect(add.getByText('Phone at fan is added')).toBeVisible();
  await add.getByRole('button', { name: 'Done' }).click();
  const devices = admin.getByRole('list', { name: /^Devices in / }); // nested under the workspace in the sidebar
  await expect(phone).toHaveURL(/\/app$/, { timeout: 15_000 });
  await phone.getByText('Microphone', { exact: true }).click();
  await phone.getByRole('button', { name: 'Start monitoring' }).click();
  await expect(phone.getByTestId('assessment')).toHaveText(/Unable to assess|Normal|Abnormal/, { timeout: 30_000 });

  await expect(devices.getByText('listening now')).toBeVisible({ timeout: 20_000 });
  await expect(admin.getByTestId('assessment')).toHaveText(/Normal|Abnormal|Unable to assess/, { timeout: 30_000 });

  // A used code does not work twice.
  const other = await (await browser.newContext()).newPage();
  await other.goto(`/pair#code=${code}`);
  await other.getByRole('button', { name: 'Pair device' }).click();
  await expect(other.getByRole('alert')).toContainText('already used');

  // Removing the device cuts it off.
  await devices.getByRole('button', { name: /^More for / }).click();
  await admin.getByRole('menuitem', { name: 'Remove device' }).click();
  await expect(devices.getByText('No devices yet')).toBeVisible();
  await expect(phone.getByRole('status').filter({ hasText: /interrupted|Monitoring/ }).first()).toBeVisible();
  await phone.getByRole('button', { name: 'Stop monitoring' }).click();

  // (the workspace log of each step is covered by the backend tests)
});
