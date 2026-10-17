import { credentials } from '../lib/credentials';
import { createHttpClient, type HttpClient } from './monitoringClient';
import { createMockClient, type MockClient } from './mockMonitoringClient';

export const isMockMode = import.meta.env.VITE_MOCK_API !== 'false';

export const client: HttpClient | MockClient = isMockMode
  ? createMockClient()
  : createHttpClient(import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000', credentials);

export const mockClient = isMockMode ? (client as MockClient) : null;
export const httpClient = isMockMode ? null : (client as HttpClient);

/** Live mode role from the setup link: a listening device, a watcher, or nothing configured yet. */
export const role: 'mock' | 'device' | 'viewer' | 'unconfigured' = isMockMode
  ? 'mock'
  : credentials?.deviceKey
    ? 'device'
    : credentials?.viewerKey
      ? 'viewer'
      : 'unconfigured';
