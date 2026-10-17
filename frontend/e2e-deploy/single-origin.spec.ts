import { expect, test } from '@playwright/test';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required (see playwright.deploy.config.ts)`);
  return v;
};

test('deployed app: phone page streams to the same-origin API and the dashboard watches it', async ({ browser, request }) => {
  const project = env('DEPLOY_PROJECT');
  const health = await (await request.get('/api/v1/health')).json();
  expect(health.service).toBe('ok');
  expect(health.model_ready).toBe(true);

  const device = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
  await device.goto(`/app?project=${project}#device=${env('DEPLOY_DEVICE_KEY')}`);
  await expect(device).toHaveURL(new RegExp(`/app\\?project=${project}$`)); // key stripped from the address bar
  if (health.mode === 'model') await expect(device.getByText('Live model')).toBeVisible();
  await device.getByText('Microphone', { exact: true }).click();
  await device.getByRole('button', { name: 'Start monitoring' }).click();
  await expect(device.getByTestId('assessment')).toHaveText(/Unable to assess|Normal|Abnormal/, { timeout: 30_000 });

  const watcher = await (await browser.newContext()).newPage();
  await watcher.goto(`/app?project=${project}#viewer=${env('DEPLOY_VIEWER_KEY')}`);
  await expect(watcher.getByText('Device streaming')).toBeVisible({ timeout: 20_000 });
  await expect(watcher.getByTestId('assessment')).toHaveText(/Normal|Abnormal|Unable to assess/, { timeout: 30_000 });
  await device.getByRole('button', { name: 'Stop monitoring' }).click();
});
