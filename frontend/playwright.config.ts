import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // Uses the locally installed Chrome; no browser download needed.
  use: { baseURL: 'http://localhost:5173', channel: 'chrome' },
  webServer: { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: true },
});
