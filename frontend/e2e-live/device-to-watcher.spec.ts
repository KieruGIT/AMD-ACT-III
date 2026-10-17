import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { LIVE } from '../playwright.live.config';

function admin(...args: string[]) {
  return execFileSync(LIVE.python, ['-m', 'app.admin', ...args], {
    cwd: LIVE.backendDir,
    env: { ...process.env, DB_PATH: LIVE.db, PUBLIC_APP_URL: LIVE.app },
    encoding: 'utf8',
  });
}
const link = (out: string, label: string) => out.split('\n').find((l) => l.startsWith(label))!.split(': ')[1].trim();

test('phone-style device streams to the API and a second screen watches it live', async ({ browser }) => {
  const project = `e2e-${Date.now()}`;
  const viewerLink = link(admin('create-project', project, 'E2E Plant'), 'Dashboard link');
  const deviceLink = link(admin('add-device', project, 'Phone at fan', '--machine', 'fan_01'), 'Listener link');

  // Listening device: real capture path (Chrome's fake microphone) → POST /analyze-window.
  const device = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
  await device.goto(deviceLink);
  await expect(device).toHaveURL(new RegExp(`/app\\?project=${project}$`)); // key stripped from the address bar
  await expect(device.getByText('Dev scorer (no trained model)')).toBeVisible();
  await device.getByText('Microphone', { exact: true }).click();
  await device.getByRole('button', { name: 'Start monitoring' }).click();
  await expect(device.getByTestId('assessment')).toHaveText(/Unable to assess|Normal|Abnormal/, { timeout: 15_000 });

  // Watcher on another "device": receives the same session over the stream.
  const watcher = await (await browser.newContext()).newPage();
  await watcher.goto(viewerLink);
  await expect(watcher.getByText('Watching project · E2E Plant')).toBeVisible();
  await expect(watcher.getByRole('radio', { name: /Phone at fan/ })).toHaveAttribute('aria-checked', 'true');
  await expect(watcher.getByText('Device streaming')).toBeVisible({ timeout: 10_000 });
  await expect(watcher.getByTestId('assessment')).toHaveText(/Normal|Abnormal|Unable to assess/, { timeout: 15_000 });
  await watcher.screenshot({ path: 'e2e/__screenshots__/live-watcher.png' });
  await device.screenshot({ path: 'e2e/__screenshots__/live-device.png' });

  // Device stops → watcher must not keep a live status.
  await device.getByRole('button', { name: 'Stop monitoring' }).click();
  await expect(watcher.getByTestId('assessment')).toHaveText(/Data stale|Monitoring interrupted/, { timeout: 10_000 });
});
