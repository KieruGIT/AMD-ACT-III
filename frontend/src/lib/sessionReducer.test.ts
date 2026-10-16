import { describe, expect, it } from 'vitest';
import type { WindowResult } from '../types/monitoring';
import { assessmentView, initialSession, sessionReducer, type SessionAction, type SessionState } from './sessionReducer';

const result = (sequence: number, over: Partial<WindowResult> = {}): WindowResult => ({
  contract_version: '1.0',
  session_id: 'sess',
  machine_id: 'fan_01',
  sequence,
  recorded_at: new Date(1_000_000 + sequence * 1000).toISOString(),
  status: 'normal',
  signal_quality: 'ok',
  anomaly_score: 0.3,
  threshold: 0.65,
  score_unit: 'reconstruction_error',
  is_probability: false,
  is_anomaly_window: false,
  alert: { triggered: false, event_id: null, reason: null },
  processing: { model_ms: 20, server_ms: 60 },
  model_version: 'mock-v1',
  ...over,
});

const reduce = (actions: SessionAction[], from: SessionState = initialSession) => actions.reduce(sessionReducer, from);
const started: SessionAction[] = [
  { type: 'start_requested' },
  { type: 'started', sessionId: 'sess', source: { kind: 'simulated', label: 'sim', sampleRate: 16000 } },
];
const got = (r: WindowResult, receivedAt = 5000): SessionAction => ({ type: 'result', result: r, receivedAt, roundTripMs: 80 });

describe('sessionReducer', () => {
  it('drops out-of-order and foreign-session results', () => {
    const s = reduce([...started, got(result(3)), got(result(2)), got(result(4, { session_id: 'old' }))]);
    expect(s.latest?.sequence).toBe(3);
    expect(s.series).toHaveLength(1);
  });

  it('ignores a result that arrives after stop', () => {
    const s = reduce([...started, { type: 'stopped' }, got(result(1))]);
    expect(s.status).toBe('stopped');
    expect(s.latest).toBeNull();
  });

  it('a backend failure interrupts immediately and the next result recovers', () => {
    let s = reduce([...started, got(result(1)), { type: 'request_failed', message: 'Backend unreachable' }]);
    expect(s.status).toBe('interrupted');
    expect(s.error?.kind).toBe('backend');
    s = reduce([got(result(2))], s);
    expect(s.status).toBe('monitoring');
    expect(s.error).toBeNull();
    expect(s.series[1].gapBefore).toBe(true);
  });

  it('a lost microphone stays interrupted even if a late result arrives', () => {
    const s = reduce([...started, { type: 'interrupted', kind: 'capture', message: 'ended' }, got(result(1))]);
    expect(s.status).toBe('interrupted');
  });

  it('bounds the series ring buffer', () => {
    const s = reduce([...started, ...Array.from({ length: 150 }, (_, i) => got(result(i + 1)))]);
    expect(s.series).toHaveLength(120);
    expect(s.series[0].sequence).toBe(31);
  });
});

describe('assessmentView never shows a stale or interrupted "normal"', () => {
  const live = reduce([...started, got(result(1), 10_000)]);
  it('is normal while fresh', () => expect(assessmentView(live, 11_000, 3000)).toBe('normal'));
  it('becomes stale when results stop arriving', () => expect(assessmentView(live, 14_000, 3000)).toBe('stale'));
  it('shows interrupted on backend failure', () => {
    const s = reduce([{ type: 'request_failed', message: 'x' }], live);
    expect(assessmentView(s, 10_500, 3000)).toBe('interrupted');
  });
  it('shows initializing before the first result', () => expect(assessmentView(reduce(started), 0, 3000)).toBe('initializing'));
  it('shows stopped after stop', () => expect(assessmentView(reduce([{ type: 'stopped' }], live), 10_500, 3000)).toBe('stopped'));
});
