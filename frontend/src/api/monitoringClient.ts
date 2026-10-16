import {
  ApiError,
  type AlertEvent,
  type AnalyzeWindowInput,
  type ConfigResponse,
  type HealthResponse,
  type MonitoringClient,
  type WindowResult,
} from '../types/monitoring';

export function createHttpClient(baseUrl: string): MonitoringClient {
  const root = `${baseUrl.replace(/\/$/, '')}/api/v1`;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${root}${path}`, init);
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new ApiError('Backend unreachable', null);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ApiError(detail || `HTTP ${res.status}`, res.status);
    }
    return res.json() as Promise<T>;
  }

  return {
    mode: 'live',
    health: (signal) => request<HealthResponse>('/health', { signal }),
    config: (signal) => request<ConfigResponse>('/config', { signal }),
    analyzeWindow(input: AnalyzeWindowInput, signal?: AbortSignal) {
      const body = new FormData();
      body.append('audio', input.audio, `window-${input.sequence}.wav`);
      body.append('machine_id', input.machine_id);
      body.append('session_id', input.session_id);
      body.append('sequence', String(input.sequence));
      body.append('recorded_at', input.recorded_at);
      return request<WindowResult>('/analyze-window', { method: 'POST', body, signal });
    },
    events: (sessionId, signal) =>
      request<AlertEvent[]>(`/sessions/${encodeURIComponent(sessionId)}/events`, { signal }),
    acknowledge: (sessionId, eventId) =>
      request<AlertEvent>(
        `/sessions/${encodeURIComponent(sessionId)}/events/${encodeURIComponent(eventId)}/ack`,
        { method: 'POST' },
      ),
  };
}
