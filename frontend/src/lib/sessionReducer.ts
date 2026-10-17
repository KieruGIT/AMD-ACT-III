import type { MonitoringStatus, SignalQuality, WindowResult } from '../types/monitoring';
import type { SourceKind } from '../audio/sources';

export const SERIES_CAPACITY = 120;

export type SessionErrorKind = 'permission' | 'no_device' | 'capture' | 'backend' | 'hidden';

export interface SeriesPoint {
  sequence: number;
  recordedAt: string;
  score: number | null;
  threshold: number | null;
  quality: SignalQuality;
  status: WindowResult['status'];
  alertTriggered: boolean;
  gapBefore: boolean;
  modelVersion: string;
}

export interface SessionState {
  status: MonitoringStatus;
  sessionId: string | null;
  source: { kind: SourceKind | 'remote'; label: string; sampleRate: number } | null;
  error: { kind: SessionErrorKind; message: string } | null;
  latest: WindowResult | null;
  lastResultAt: number | null; // client clock (ms) when `latest` arrived
  roundTripMs: number | null;
  series: SeriesPoint[];
  windowsSent: number;
  windowsSkipped: number;
  failures: number;
  pendingGap: boolean;
}

export type SessionAction =
  | { type: 'start_requested' }
  | { type: 'started'; sessionId: string; source: NonNullable<SessionState['source']> }
  | { type: 'start_failed'; kind: SessionErrorKind; message: string }
  | { type: 'window_sent' }
  | { type: 'window_skipped' }
  | { type: 'result'; result: WindowResult; receivedAt: number; roundTripMs: number | null }
  | { type: 'request_failed'; message: string }
  | { type: 'interrupted'; kind: SessionErrorKind; message: string }
  | { type: 'stopped' };

export const initialSession: SessionState = {
  status: 'idle',
  sessionId: null,
  source: null,
  error: null,
  latest: null,
  lastResultAt: null,
  roundTripMs: null,
  series: [],
  windowsSent: 0,
  windowsSkipped: 0,
  failures: 0,
  pendingGap: false,
};

const active = (s: SessionState) => s.status === 'monitoring' || s.status === 'interrupted';

export function sessionReducer(s: SessionState, a: SessionAction): SessionState {
  switch (a.type) {
    case 'start_requested':
      return { ...initialSession, status: 'requesting_permission' };
    case 'started':
      return { ...s, status: 'monitoring', sessionId: a.sessionId, source: a.source, error: null };
    case 'start_failed':
      return { ...s, status: 'idle', error: { kind: a.kind, message: a.message } };
    case 'window_sent':
      return active(s) ? { ...s, windowsSent: s.windowsSent + 1 } : s;
    case 'window_skipped':
      return active(s) ? { ...s, windowsSkipped: s.windowsSkipped + 1, pendingGap: true } : s;
    case 'result': {
      const r = a.result;
      // Late results after stop, from an old session, or out of order are dropped.
      if (!active(s) || r.session_id !== s.sessionId) return s;
      if (s.latest && r.sequence <= s.latest.sequence) return s;
      const point: SeriesPoint = {
        sequence: r.sequence,
        recordedAt: r.recorded_at,
        score: r.anomaly_score,
        threshold: r.threshold,
        quality: r.signal_quality,
        status: r.status,
        alertTriggered: r.alert.triggered,
        gapBefore: s.pendingGap,
        modelVersion: r.model_version,
      };
      const recovered = s.error?.kind === 'backend' || s.error?.kind === 'hidden';
      return {
        ...s,
        status: recovered || s.status === 'monitoring' ? 'monitoring' : s.status,
        error: recovered ? null : s.error,
        latest: r,
        lastResultAt: a.receivedAt,
        roundTripMs: a.roundTripMs,
        series: [...s.series, point].slice(-SERIES_CAPACITY),
        failures: 0,
        pendingGap: false,
      };
    }
    case 'request_failed':
      if (!active(s)) return s;
      return {
        ...s,
        status: 'interrupted',
        error: { kind: 'backend', message: a.message },
        failures: s.failures + 1,
        pendingGap: true,
      };
    case 'interrupted':
      if (!active(s)) return s;
      return { ...s, status: 'interrupted', error: { kind: a.kind, message: a.message }, pendingGap: true };
    case 'stopped':
      return s.status === 'idle' ? s : { ...s, status: 'stopped', error: null };
  }
}

export type AssessmentView =
  | 'idle' | 'initializing' | 'normal' | 'anomaly' | 'unable_to_assess'
  | 'interrupted' | 'stale' | 'stopped';

/** What the assessment card may claim right now. Never a stale or interrupted "normal". */
export function assessmentView(s: SessionState, now: number, staleAfterMs: number): AssessmentView {
  if (s.status === 'stopped') return 'stopped';
  if (s.status === 'interrupted') return 'interrupted';
  if (s.status !== 'monitoring') return 'idle';
  if (!s.latest || s.lastResultAt === null) return 'initializing';
  if (now - s.lastResultAt > staleAfterMs) return 'stale';
  return s.latest.status;
}
