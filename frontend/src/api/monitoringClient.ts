import type { Credentials } from '../lib/credentials';
import {
  ApiError,
  type AlertEvent,
  type AnalyzeWindowInput,
  type AuditEntry,
  type ConfigResponse,
  type HealthResponse,
  type Invitation,
  type Me,
  type Member,
  type MonitoringClient,
  type PairedDevice,
  type PairingCode,
  type ProjectOverview,
  type Role,
  type StreamMessage,
  type WindowResult,
  type Workspace,
} from '../types/monitoring';

export interface HttpClient extends MonitoringClient {
  readonly credentials: Credentials | null;
  project(signal?: AbortSignal): Promise<ProjectOverview>;
  /** Server-Sent Events over fetch (EventSource cannot send auth headers). Resolves when the stream ends. */
  stream(onMessage: (m: StreamMessage) => void, signal: AbortSignal): Promise<void>;
  account: AccountApi;
}

/** Accounts and administration. Project-scoped calls act on the current workspace. */
export interface AccountApi {
  startGuest(name: string): Promise<{ project_id: string; name: string; guest_key: string; expires_at: string }>;
  me(): Promise<Me>;
  createWorkspace(name: string): Promise<Workspace>;
  pair(code: string, deviceName?: string): Promise<PairedDevice>;
  /** A paired device asks whether it has been approved yet. */
  pairStatus(projectId: string, deviceKey: string): Promise<{ status: 'pending' | 'approved' | 'rejected' | 'expired' }>;
  approveDevice(deviceId: string): Promise<unknown>;
  renameWorkspace(name: string): Promise<{ id: string; name: string }>;
  deleteWorkspace(): Promise<unknown>;
  relearnDevice(deviceId: string): Promise<unknown>;
  renameDevice(deviceId: string, name: string): Promise<{ id: string; name: string }>;
  members(): Promise<{ members: Member[]; invitations: Invitation[] }>;
  invite(email: string, role: Role): Promise<{ email: string; role: Role }>;
  cancelInvitation(email: string): Promise<unknown>;
  changeRole(userId: string, role: Role): Promise<unknown>;
  removeMember(userId: string): Promise<unknown>;
  pairingCode(deviceName: string, machineId: string): Promise<PairingCode>;
  revokeDevice(deviceId: string): Promise<unknown>;
  /** My own alert e-mails for this workspace (every member gets them unless they turn them off). */
  setEmailAlerts(on: boolean): Promise<{ email_alerts: boolean }>;
  audit(): Promise<AuditEntry[]>;
}

export function createHttpClient(
  baseUrl: string,
  credentials: Credentials | null,
  token: () => Promise<string | null> = async () => null,
): HttpClient {
  const root = `${baseUrl.replace(/\/$/, '')}/api/v1`;
  const pid = () => encodeURIComponent(credentials?.projectId ?? '');

  async function authHeaders(): Promise<Record<string, string>> {
    const h: Record<string, string> = {};
    if (credentials) {
      h['X-Project-Id'] = credentials.projectId;
      if (credentials.deviceKey) h['X-Device-Key'] = credentials.deviceKey;
      if (credentials.viewerKey) h['X-Viewer-Key'] = credentials.viewerKey;
      if (credentials.guestKey) h['X-Guest-Key'] = credentials.guestKey;
    }
    if (!credentials?.deviceKey && !credentials?.guestKey && !credentials?.viewerKey) {
      const t = await token();
      if (t) h.Authorization = `Bearer ${t}`;
    }
    return h;
  }

  async function send(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${root}${path}`, { ...init, headers: { ...(await authHeaders()), ...init.headers } });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new ApiError('Backend unreachable', null);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const detail = typeof body?.detail === 'string' ? body.detail : Array.isArray(body?.detail) ? body.detail[0]?.msg : null;
      throw new ApiError(detail ?? `HTTP ${res.status}`, res.status);
    }
    return res;
  }
  const json = async <T,>(path: string, init?: RequestInit) => (await send(path, init)).json() as Promise<T>;
  const body = (method: string, data?: unknown): RequestInit => ({
    method,
    ...(data !== undefined && { body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
  });

  const account: AccountApi = {
    startGuest: (name) => json('/guest', body('POST', { name })),
    me: () => json('/me'),
    createWorkspace: (name) => json('/workspaces', body('POST', { name })),
    pair: (code, deviceName) => json('/pair', body('POST', { code, device_name: deviceName })),
    pairStatus: (projectId, deviceKey) => json('/pair/status', { headers: { 'X-Project-Id': projectId, 'X-Device-Key': deviceKey } }),
    renameWorkspace: (name) => json(`/projects/${pid()}`, body('PATCH', { name })),
    deleteWorkspace: () => json(`/projects/${pid()}`, body('DELETE')),
    approveDevice: (deviceId) => json(`/projects/${pid()}/devices/${encodeURIComponent(deviceId)}/approve`, body('POST')),
    renameDevice: (deviceId, name) => json(`/projects/${pid()}/devices/${encodeURIComponent(deviceId)}`, body('PATCH', { name })),
    relearnDevice: (deviceId) => json(`/projects/${pid()}/devices/${encodeURIComponent(deviceId)}/relearn`, body('POST')),
    members: () => json(`/projects/${pid()}/members`),
    invite: (email, role) => json(`/projects/${pid()}/invitations`, body('POST', { email, role })),
    cancelInvitation: (email) => json(`/projects/${pid()}/invitations/${encodeURIComponent(email)}`, body('DELETE')),
    changeRole: (userId, role) => json(`/projects/${pid()}/members/${encodeURIComponent(userId)}`, body('PATCH', { role })),
    removeMember: (userId) => json(`/projects/${pid()}/members/${encodeURIComponent(userId)}`, body('DELETE')),
    pairingCode: (deviceName, machineId) =>
      json(`/projects/${pid()}/pairing-codes`, body('POST', { device_name: deviceName, machine_id: machineId })),
    revokeDevice: (deviceId) => json(`/projects/${pid()}/devices/${encodeURIComponent(deviceId)}/revoke`, body('POST')),
    setEmailAlerts: (on) => json(`/projects/${pid()}/me`, body('PATCH', { email_alerts: on })),
    audit: () => json(`/projects/${pid()}/audit`),
  };

  return {
    mode: 'live',
    credentials,
    account,
    health: (signal) => json<HealthResponse>('/health', { signal }),
    config: (signal) => json<ConfigResponse>('/config', { signal }),
    analyzeWindow(input: AnalyzeWindowInput, signal?: AbortSignal) {
      const form = new FormData();
      form.append('audio', input.audio, `window-${input.sequence}.wav`);
      form.append('machine_id', input.machine_id);
      form.append('session_id', input.session_id);
      form.append('sequence', String(input.sequence));
      form.append('recorded_at', input.recorded_at);
      return json<WindowResult>('/analyze-window', { method: 'POST', body: form, signal });
    },
    events: (sessionId, signal) => json<AlertEvent[]>(`/sessions/${encodeURIComponent(sessionId)}/events`, { signal }),
    acknowledge: (sessionId, eventId) =>
      json<AlertEvent>(`/sessions/${encodeURIComponent(sessionId)}/events/${encodeURIComponent(eventId)}/ack`, { method: 'POST' }),
    project: (signal) => json<ProjectOverview>(`/projects/${pid()}`, { signal }),
    async stream(onMessage, signal) {
      const res = await send(`/projects/${pid()}/stream`, { signal });
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
