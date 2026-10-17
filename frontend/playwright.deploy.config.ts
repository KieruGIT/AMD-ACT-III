import { defineConfig } from '@playwright/test';

// Smoke test of a DEPLOYED single-origin app (deploy/hf_space.py), or a local run of the same build:
//   DEPLOY_URL=https://<space>.hf.space DEPLOY_PROJECT=demo DEPLOY_VIEWER_KEY=vk_... DEPLOY_DEVICE_KEY=dk_... \
//   npx playwright test -c playwright.deploy.config.ts
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
