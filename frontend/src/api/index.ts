import { credentials } from '../lib/credentials';
import { accessToken } from '../lib/supabase';
import { createHttpClient, type HttpClient } from './monitoringClient';
import { createMockClient, type MockClient } from './mockMonitoringClient';

/** /demo always runs the simulated console in the browser (demo audio + scenarios), no account or backend needed. */
export const isDemo = location.pathname.startsWith('/demo');
export const isMockMode = isDemo || import.meta.env.VITE_MOCK_API !== 'false';

export const client: HttpClient | MockClient = isMockMode
  ? createMockClient()
  : createHttpClient(import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000', credentials, accessToken);

export const mockClient = isMockMode ? (client as MockClient) : null;
export const httpClient = isMockMode ? null : (client as HttpClient);

/** Account calls that do not depend on the workspace this browser has open (sign-in, guest, pairing, my workspaces). */
export const accounts = createHttpClient(import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000', null, accessToken).account;

/**
 * Live mode role of this browser: a listening device, a watcher of a workspace (signed-in member, guest, or legacy
 * viewer link), or nothing chosen yet (the console sends you to sign in).
 */
export const role: 'mock' | 'device' | 'member' | 'guest' | 'viewer' | 'unconfigured' = isMockMode
  ? 'mock'
  : credentials?.deviceKey
    ? 'device'
    : credentials?.guestKey
      ? 'guest'
      : credentials?.member
        ? 'member'
        : credentials?.viewerKey
          ? 'viewer'
          : 'unconfigured';
