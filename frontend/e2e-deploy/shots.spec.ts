import { test } from '@playwright/test';

// Not a test: captures the account screens and the console for review. Run with SHOTS_DIR set.
test.skip(!process.env.SHOTS_DIR, 'set SHOTS_DIR to capture screenshots');

test('capture account screens', async ({ page }) => {
  const dir = process.env.SHOTS_DIR!;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/signin');
  await page.screenshot({ path: `${dir}/signin.png` });
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await page.waitForURL(/\/app$/);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${dir}/console-guest.png` });
  await page.getByRole('button', { name: 'Add device' }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${dir}/console-add-device.png` });
  await page.getByRole('button', { name: 'Account' }).click();
  await page.screenshot({ path: `${dir}/console-account.png` });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/console-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.screenshot({ path: `${dir}/console-mobile-menu.png` });
});
