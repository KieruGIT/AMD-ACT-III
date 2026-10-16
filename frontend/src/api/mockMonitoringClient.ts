import {
  ApiError,
  type AlertEvent,
  type ConfigResponse,
  type MonitoringClient,
  type WindowResult,
} from '../types/monitoring';
import { AlertAggregator } from './mock/alertPolicy';

// Deterministic simulated backend implementing the same MonitoringClient interface as the HTTP
// client. Every value it produces is fake and the UI labels it "Simulation".

export const MOCK_SCENARIOS = [
  { id: 'normal', label: 'Normal operation', hint: 'Low, stable scores' },
  { id: 'anomaly', label: 'Sustained anomaly', hint: 'Repeated high scores → one alert' },
  { id: 'transient_spike', label: 'Transient spike', hint: 'Single high window, no alert' },
  { id: 'silence', label: 'Silence / poor signal', hint: 'Unable to assess' },
  { id: 'slow_response', label: 'Slow backend', hint: 'Responses slower than the hop; windows skipped' },
  { id: 'backend_offline', label: 'Backend offline', hint: 'Requests fail; monitoring interrupted' },
  { id: 'mic_denied', label: 'Microphone denied', hint: 'Permission failure on start' },
] as const;

export type MockScenario = (typeof MOCK_SCENARIOS)[number]['id'];

export const MOCK_CONFIG: ConfigResponse = {
  contract_version: '1.0',
  supported_profiles: [{ id: 'fan_01', label: 'Demo Fan', machine_type: 'fan' }],
  input: {
    sample_rate_hz: 16000,
    channels: 1,
    format: 'wav_pcm_s16le',
    window_ms: 3000,
    hop_ms: 1000,
    max_upload_bytes: 500000,
  },
  score: { name: 'reconstruction_error', higher_means_more_anomalous: true, is_probability: false },
  alert_policy: { min_anomalous_windows: 3, consider_last_valid_windows: 5, cooldown_seconds: 30 },
};

const THRESHOLD = 0.65;
const MODEL_VERSION = 'mock-v1';

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Scripted score for the k-th window since the scenario began. null = unable to assess. */
export function scriptedScore(scenario: MockScenario, k: number, rand: () => number): number | null {
  const normal = 0.3 + rand() * 0.12;
  switch (scenario) {
    case 'silence':
      return null;
    case 'transient_spike':
      return k % 10 === 3 ? 0.88 + rand() * 0.05 : normal;
    case 'anomaly':
      return k < 1 ? normal : 0.74 + rand() * 0.18;
    default:
      return normal;
  }
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

export interface MockClient extends MonitoringClient {
  scenario: MockScenario;
  setScenario(s: MockScenario): void;
}

export function createMockClient(opts: { seed?: number; latencyScale?: number } = {}): MockClient {
  const rand = mulberry32(opts.seed ?? 42);
  const scale = opts.latencyScale ?? 1;
  const sessions = new Map<string, AlertAggregator>();
  let idCounter = 0;
  let scenarioStart = 0;
  let windowsSeen = 0;

  const aggregatorFor = (sessionId: string) => {
    let agg = sessions.get(sessionId);
    if (!agg) {
      agg = new AlertAggregator(MOCK_CONFIG.alert_policy, () => `evt-${++idCounter}`);
      sessions.set(sessionId, agg);
    }
    return agg;
  };

  const offline = () => client.scenario === 'backend_offline';

  const client: MockClient = {
    mode: 'mock',
    scenario: 'normal',
    setScenario(s) {
      client.scenario = s;
      scenarioStart = windowsSeen;
    },

    async health(signal) {
      await wait(80 * scale, signal);
      if (offline()) throw new ApiError('Backend unreachable', null);
      return { service: 'ok', model_ready: true, mode: 'mock', model_version: MODEL_VERSION };
    },

    async config(signal) {
      await wait(80 * scale, signal);
      if (offline()) throw new ApiError('Backend unreachable', null);
      return MOCK_CONFIG;
    },

    async analyzeWindow(input, signal) {
      const slow = client.scenario === 'slow_response';
      const serverMs = Math.round((slow ? 2600 : 70 + rand() * 50) * scale);
      await wait(offline() ? 300 * scale : serverMs, signal);
      if (offline()) throw new ApiError('Backend unreachable', null);
      if (input.audio.size <= 44) throw new ApiError('audio: empty or corrupt WAV', 422);
      if (input.audio.size > MOCK_CONFIG.input.max_upload_bytes) throw new ApiError('audio: payload too large', 413);
      if (!MOCK_CONFIG.supported_profiles.some((p) => p.id === input.machine_id)) {
        throw new ApiError(`machine_id: unsupported profile ${input.machine_id}`, 422);
      }

      const k = windowsSeen++ - scenarioStart;
      const score = scriptedScore(client.scenario, k, rand);
      const valid = score !== null;
      const isAnomaly = valid ? score > THRESHOLD : null;
      const alert = aggregatorFor(input.session_id).observe({
        valid,
        isAnomaly: !!isAnomaly,
        score,
        threshold: THRESHOLD,
        recordedAt: input.recorded_at,
        sessionId: input.session_id,
        machineId: input.machine_id,
      });

      const result: WindowResult = {
        contract_version: '1.0',
        session_id: input.session_id,
        machine_id: input.machine_id,
        sequence: input.sequence,
        recorded_at: input.recorded_at,
        status: !valid ? 'unable_to_assess' : isAnomaly ? 'anomaly' : 'normal',
        signal_quality: valid ? 'ok' : 'silence',
        anomaly_score: score,
        threshold: valid ? THRESHOLD : null,
        score_unit: MOCK_CONFIG.score.name,
        is_probability: false,
        is_anomaly_window: isAnomaly,
        alert: { triggered: alert.triggered, event_id: alert.eventId, reason: alert.reason },
        processing: { model_ms: valid ? Math.round(serverMs * 0.35) : null, server_ms: serverMs },
        model_version: MODEL_VERSION,
        spectrogram_overlay: null,
      };
      return result;
    },

    async events(sessionId, signal) {
      await wait(40 * scale, signal);
      if (offline()) throw new ApiError('Backend unreachable', null);
      return (sessions.get(sessionId)?.events ?? []).map((e) => ({ ...e }));
    },

    async acknowledge(sessionId, eventId) {
      await wait(60 * scale);
      if (offline()) throw new ApiError('Backend unreachable', null);
      const ev = sessions.get(sessionId)?.events.find((e) => e.event_id === eventId);
      if (!ev) throw new ApiError('event not found', 404);
      ev.acknowledged_at ??= new Date().toISOString();
      return { ...ev } satisfies AlertEvent;
    },
  };
  return client;
}
