import { describe, expect, it } from 'vitest';
import { AlertAggregator } from './alertPolicy';

const POLICY = { min_anomalous_windows: 3, consider_last_valid_windows: 5, cooldown_seconds: 30 };
const T0 = Date.parse('2026-10-16T07:00:00Z');

function run(pattern: (boolean | null)[], startSec = 0, agg = new AlertAggregator(POLICY, idGen())) {
  const decisions = pattern.map((p, i) =>
    agg.observe({
      valid: p !== null,
      isAnomaly: !!p,
      score: p ? 0.9 : 0.3,
      threshold: 0.65,
      recordedAt: new Date(T0 + (startSec + i) * 1000).toISOString(),
      sessionId: 's',
      machineId: 'fan_01',
    }),
  );
  return { agg, decisions, triggered: decisions.filter((d) => d.triggered).length };
}

function idGen() {
  let n = 0;
  return () => `e${++n}`;
}

const A = true;
const N = false;

describe('AlertAggregator (mock of backend policy)', () => {
  it('a single spike never alerts', () => {
    expect(run([N, N, A, N, N, N, N]).triggered).toBe(0);
  });

  it('two anomalies in five windows do not alert', () => {
    expect(run([A, N, A, N, N, A, N, N, N, N]).triggered).toBe(0);
  });

  it('fires once at the third anomalous window of the last five', () => {
    const { decisions, agg } = run([N, A, N, A, A]);
    expect(decisions.map((d) => d.triggered)).toEqual([false, false, false, false, true]);
    expect(decisions[4].reason).toBe('3 of the last 5 valid windows exceeded threshold');
    expect(agg.events[0].started_at).toBe(new Date(T0 + 1000).toISOString()); // first anomalous window
    expect(agg.events[0].anomalous_window_count).toBe(3);
  });

  it('a long uninterrupted anomaly stays one event, even past the cooldown', () => {
    const { triggered, agg } = run(Array(120).fill(A));
    expect(triggered).toBe(1);
    expect(agg.events).toHaveLength(1);
    expect(agg.events[0].ended_at).toBeNull();
    expect(agg.events[0].anomalous_window_count).toBe(120); // 3 at trigger + 117 after
  });

  it('closes after 5 consecutive normal windows, then enforces the cooldown', () => {
    const agg = new AlertAggregator(POLICY, idGen());
    run([A, A, A, N, N, N, N, N], 0, agg);
    expect(agg.events[0].ended_at).toBe(new Date(T0 + 7000).toISOString());
    // Anomalies 10 s later fall inside the 30 s cooldown.
    expect(run([A, A, A, A], 10, agg).triggered).toBe(0);
    // After the cooldown a new event may fire.
    expect(run([N, A, A, A], 40, agg).triggered).toBe(1);
    expect(agg.events).toHaveLength(2);
  });

  it('a normal dip inside an ongoing anomaly does not end it', () => {
    const { agg, triggered } = run([A, A, A, N, A, N, A, A]);
    expect(triggered).toBe(1);
    expect(agg.events[0].ended_at).toBeNull();
  });

  it('unassessable windows do not count toward the rule', () => {
    expect(run([A, null, null, A, null, null, null]).triggered).toBe(0);
  });

  it('resets the count after a long gap between valid windows', () => {
    const agg = new AlertAggregator(POLICY, idGen());
    run([A, A], 0, agg);
    expect(run([A], 60, agg).triggered).toBe(0);
  });
});
