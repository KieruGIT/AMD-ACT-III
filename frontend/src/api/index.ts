import type { MonitoringClient } from '../types/monitoring';
import { createHttpClient } from './monitoringClient';
import { createMockClient, type MockClient } from './mockMonitoringClient';

export const isMockMode = import.meta.env.VITE_MOCK_API !== 'false';

export const client: MonitoringClient | MockClient = isMockMode
  ? createMockClient()
  : createHttpClient(import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000');

export const mockClient = isMockMode ? (client as MockClient) : null;
