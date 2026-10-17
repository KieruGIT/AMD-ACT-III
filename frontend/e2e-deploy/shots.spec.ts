import { test } from '@playwright/test';

// Not a test: captures the account screens for review. Run with SHOTS_DIR set.
test.skip(!process.env.SHOTS_DIR, 'set SHOTS_DIR to capture screenshots');

test('capture account screens', async ({ page }) => {
  const dir = process.env.SHOTS_DIR!;
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/signin');
  await page.screenshot({ path: `${dir}/signin.png` });
  await page.goto('/pair#code=ABCD2345');
  await page.screenshot({ path: `${dir}/pair.png` });
  await page.goto('/signin');
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await page.waitForURL(/\/app$/);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${dir}/console-guest.png` });
  await page.getByRole('button', { name: 'Add a device' }).click();
  await page.getByRole('button', { name: 'Get pairing code' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/devices.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.screenshot({ path: `${dir}/console-mobile.png` });
});
