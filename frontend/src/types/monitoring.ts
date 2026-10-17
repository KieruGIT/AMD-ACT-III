// API contract v1 — mirrors docs PROJECT_PLAN.md §5. Do not change fields without the AI developer.

export type MonitoringStatus =
  | 'idle'
  | 'requesting_permission'
  | 'monitoring'
  | 'interrupted'
  | 'stopped';

export type AssessmentStatus = 'normal' | 'anomaly' | 'unable_to_assess';

export type SignalQuality =
  | 'ok' | 'silence' | 'clipping' | 'noisy'
  | 'unsupported' | 'unknown';

export interface WindowResult {
  contract_version: '1.0';
  session_id: string;
  machine_id: string;
  sequence: number;
  recorded_at: string;
  status: AssessmentStatus;
  signal_quality: SignalQuality;
  anomaly_score: number | null;
  threshold: number | null;
  score_unit: string;
  is_probability: false;
  is_anomaly_window: boolean | null;
  alert: {
    triggered: boolean;
    event_id: string | null;
    reason: string | null;
  };
  processing: { model_ms: number | null; server_ms: number | null };
  model_version: string;
  spectrogram_overlay?: null | {
    time_bins: number;
    frequency_bins: number;
    values: number[];
  };
  /** Proposed v1.1: why a window was not assessed (e.g. "learning this session's baseline"). */
  note?: string | null;
  /** Proposed v1.1, present only when the backend runs with INTERFERENCE=flag. Never changes status or alerts. */
  interference?: null | {
    flags: ('speech' | 'transient')[];
    speech_seconds?: number | null;
    transients_in_window_s?: number[];
    new_transients_at_s?: number[];
    speech_detector?: string | null;
    checked?: boolean;
    // Over the windows the alert policy is currently counting (by window identity, reset by gaps):
    recent_windows?: number;
    recent_windows_flagged?: number;
    recent_windows_unchecked?: number;
    recent_flags?: ('speech' | 'transient')[];
    errors?: string[];
    affects_decision: false;
  };
}

export interface HealthResponse {
  service: 'ok' | string;
  model_ready: boolean;
  mode: 'mock' | 'live' | string;
  model_version: string;
}

export interface MachineProfile {
  id: string;
  label: string;
  machine_type: string;
}

export interface ConfigResponse {
  contract_version: string;
  supported_profiles: MachineProfile[];
  input: {
    sample_rate_hz: number;
    channels: number;
    format: string;
    window_ms: number;
    hop_ms: number;
    max_upload_bytes: number;
  };
  score: {
    name: string;
    higher_means_more_anomalous: boolean;
    is_probability: boolean;
  };
  alert_policy: {
    min_anomalous_windows: number;
    consider_last_valid_windows: number;
    cooldown_seconds: number;
  };
}

// The plan lists GET /sessions/{id}/events without a schema. This shape (plus the ack route) is a
// PROPOSED v1.1 addition, pending AI-developer sign-off.
export interface AlertEvent {
  event_id: string;
  session_id: string;
  machine_id: string;
  started_at: string;
  last_anomalous_at: string;
  ended_at: string | null; // null while the anomaly is still ongoing
  anomalous_window_count: number;
  peak_score: number;
  threshold: number;
  reason: string;
  acknowledged_at: string | null; // acknowledgment is not repair
  interference_note?: string | null; // INTERFERENCE=flag only: speech/impact seen when the event opened
}

export interface AnalyzeWindowInput {
  audio: Blob;
  machine_id: string;
  session_id: string;
  sequence: number;
  recorded_at: string;
}

// --- Proposed v1.1: projects, devices and live watching (backend/app/routers/api.py) ---
export interface DeviceSummary {
  id: string;
  name: string;
  machine_id: string;
  last_seen_at: string | null;
  latest: WindowResult | null;
}

export interface ProjectOverview {
  id: string;
  name: string;
  devices: DeviceSummary[];
  events: (AlertEvent & { device_id: string })[];
}

export type StreamMessage = { replay?: boolean } & (
  | { type: 'window'; device_id: string; device_name: string; result: WindowResult; event: AlertEvent | null }
  | { type: 'event'; event: AlertEvent & { device_id: string } }
);

export interface MonitoringClient {
  readonly mode: 'mock' | 'live';
  health(signal?: AbortSignal): Promise<HealthResponse>;
  config(signal?: AbortSignal): Promise<ConfigResponse>;
  analyzeWindow(input: AnalyzeWindowInput, signal?: AbortSignal): Promise<WindowResult>;
  events(sessionId: string, signal?: AbortSignal): Promise<AlertEvent[]>;
  acknowledge(sessionId: string, eventId: string): Promise<AlertEvent>;
}

export class ApiError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}
