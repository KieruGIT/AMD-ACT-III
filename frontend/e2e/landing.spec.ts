import { expect, test } from '@playwright/test';

const SHOTS = 'e2e/__screenshots__';

// The whole hero (text and visual) must fit the first screen on common laptop/desktop sizes.
for (const [w, h] of [[1280, 720], [1366, 768], [1440, 900], [1536, 864], [1920, 1080]]) {
  test(`hero fits the first screen at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/');
    const hero = await page.getByTestId('hero').boundingBox();
    expect(hero).not.toBeNull();
    expect(hero!.y + hero!.height).toBeLessThanOrEqual(h + 1);
    const cta = await page.getByRole('link', { name: 'Get started' }).first().boundingBox();
    expect(cta!.y + cta!.height).toBeLessThanOrEqual(h);
    await page.waitForTimeout(2600); // let entry motion settle
    await page.screenshot({ path: `${SHOTS}/hero-${w}x${h}.png` });
  });
}

test('mobile layout has no horizontal overflow and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  // Scroll through so every reveal fires, then capture.
  for (let y = 0; y < 12000; y += 600) {
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: `${SHOTS}/mobile-full.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('desktop full page renders every section after scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  for (let y = 0; y < 9000; y += 500) {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(1200);
  await expect(page.locator('[data-reveal]:not(.in)')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/desktop-full.png`, fullPage: true });
});

test('reduced motion shows all content without animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByText('Alerts an operator can believe.')).toBeVisible();
});

test('landing CTA opens sign-in', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Get started' }).first().click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole('button', { name: 'Continue as guest' })).toBeVisible();
});

test('header shows Sign in for a new visitor and Open console once this browser has a workspace', async ({ page }) => {
  await page.goto('/');
  const header = page.getByRole('banner');
  await expect(header.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin');
  await expect(header.getByRole('link', { name: 'Open console' })).toHaveCount(0);

  await page.evaluate(() => localStorage.setItem('msm:credentials', JSON.stringify({ projectId: 'demo', member: true })));
  await page.reload();
  await expect(header.getByRole('link', { name: 'Open console' })).toHaveAttribute('href', '/app');
  await expect(header.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
});
