import { expect, test, type Page } from '@playwright/test';

const scenario = (page: Page, value: string) => page.getByLabel('Simulation scenario').selectOption(value);
const assessment = (page: Page) => page.getByTestId('assessment');

test('demo scenarios drive the console end to end (mock backend)', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: 'Start monitoring' }).click();
  await expect(assessment(page)).toHaveText(/Normal/, { timeout: 8000 });

  await scenario(page, 'transient_spike');
  await page.waitForTimeout(6000);
  await expect(page.getByText('Persistent acoustic anomaly')).toHaveCount(0);

  await scenario(page, 'anomaly');
  await expect(page.getByRole('alert').filter({ hasText: 'Persistent acoustic anomaly' })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: /Alert history/ }).click();
  await expect(page.getByRole('dialog').getByText('Persistent acoustic anomaly')).toHaveCount(1); // one event, not one per window
  await page.keyboard.press('Escape');

  await scenario(page, 'backend_offline');
  await expect(assessment(page)).toHaveText(/Monitoring interrupted/, { timeout: 4000 });

  await page.getByRole('button', { name: 'Stop monitoring' }).click();
  await expect(assessment(page)).toHaveText(/Stopped/);
});
