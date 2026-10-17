import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// End-to-end against the real FastAPI backend (dev scorer): `npm run e2e:live`.
const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../backend');
const python = path.join(backendDir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
export const LIVE = { python, backendDir, db: path.join(backendDir, 'data', 'e2e.db'), api: 'http://localhost:8010', app: 'http://localhost:5180' };

export default defineConfig({
  testDir: './e2e-live',
  timeout: 120_000,
  use: {
    baseURL: LIVE.app,
    channel: 'chrome',
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
    permissions: ['microphone'],
  },
  webServer: [
    {
      command: `"${python}" -m uvicorn app.main:app --port 8010`,
      cwd: backendDir,
      url: `${LIVE.api}/api/v1/health`,
      env: { DB_PATH: LIVE.db, CORS_ORIGINS: LIVE.app, PUBLIC_APP_URL: LIVE.app },
      reuseExistingServer: false,
    },
    {
      command: 'npx vite --port 5180 --strictPort',
      url: LIVE.app,
      env: { VITE_MOCK_API: 'false', VITE_API_BASE_URL: LIVE.api },
      reuseExistingServer: false,
    },
  ],
});
