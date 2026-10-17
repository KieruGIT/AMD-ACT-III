import type { Credentials } from '../lib/credentials';
import {
  ApiError,
  type AlertEvent,
  type AnalyzeWindowInput,
  type ConfigResponse,
  type HealthResponse,
  type MonitoringClient,
  type ProjectOverview,
  type StreamMessage,
  type WindowResult,
} from '../types/monitoring';

export interface HttpClient extends MonitoringClient {
  readonly credentials: Credentials | null;
  project(signal?: AbortSignal): Promise<ProjectOverview>;
  /** Server-Sent Events over fetch (EventSource cannot send auth headers). Resolves when the stream ends. */
  stream(onMessage: (m: StreamMessage) => void, signal: AbortSignal): Promise<void>;
}

export function createHttpClient(baseUrl: string, credentials: Credentials | null): HttpClient {
  const root = `${baseUrl.replace(/\/$/, '')}/api/v1`;
  const auth: Record<string, string> = {};
  if (credentials) {
    auth['X-Project-Id'] = credentials.projectId;
    if (credentials.deviceKey) auth['X-Device-Key'] = credentials.deviceKey;
    if (credentials.viewerKey) auth['X-Viewer-Key'] = credentials.viewerKey;
  }

  async function send(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${root}${path}`, { ...init, headers: { ...auth, ...init.headers } });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new ApiError('Backend unreachable', null);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(body?.detail ?? `HTTP ${res.status}`, res.status);
    }
    return res;
  }
  const json = async <T,>(path: string, init?: RequestInit) => (await send(path, init)).json() as Promise<T>;

  return {
    mode: 'live',
    credentials,
    health: (signal) => json<HealthResponse>('/health', { signal }),
    config: (signal) => json<ConfigResponse>('/config', { signal }),
    analyzeWindow(input: AnalyzeWindowInput, signal?: AbortSignal) {
      const body = new FormData();
      body.append('audio', input.audio, `window-${input.sequence}.wav`);
      body.append('machine_id', input.machine_id);
      body.append('session_id', input.session_id);
      body.append('sequence', String(input.sequence));
      body.append('recorded_at', input.recorded_at);
      return json<WindowResult>('/analyze-window', { method: 'POST', body, signal });
    },
    events: (sessionId, signal) => json<AlertEvent[]>(`/sessions/${encodeURIComponent(sessionId)}/events`, { signal }),
    acknowledge: (sessionId, eventId) =>
      json<AlertEvent>(`/sessions/${encodeURIComponent(sessionId)}/events/${encodeURIComponent(eventId)}/ack`, { method: 'POST' }),
    project: (signal) => json<ProjectOverview>(`/projects/${encodeURIComponent(credentials?.projectId ?? '')}`, { signal }),
    async stream(onMessage, signal) {
      const res = await send(`/projects/${encodeURIComponent(credentials?.projectId ?? '')}/stream`, { signal });
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += value;
        let cut: number;
        while ((cut = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          const data = frame.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
          if (data) onMessage(JSON.parse(data) as StreamMessage);
        }
      }
    },
  };
}
