import { test } from '@playwright/test';

// Not a test: captures the landing hero (steady and burst moments) for design review. Run with SHOTS_DIR set.
test.skip(!process.env.SHOTS_DIR, 'set SHOTS_DIR to capture screenshots');

test('capture hero', async ({ page }) => {
  const dir = process.env.SHOTS_DIR!;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${dir}/hero-steady.png` });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${dir}/hero-burst.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/hero-mobile.png` });
});
