import { defineConfig } from '@playwright/test';

// Tests against a running live stack (deployed, or a local backend + live build):
//   DEPLOY_URL=https://<frontend> npx playwright test -c playwright.deploy.config.ts accounts   (guest + pairing)
export default defineConfig({
  testDir: './e2e-deploy',
  timeout: 120_000,
  use: {
    baseURL: process.env.DEPLOY_URL,
    channel: 'chrome',
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
    permissions: ['microphone'],
  },
});
