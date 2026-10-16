import { describe, expect, it } from 'vitest';
import { wavBlob } from '../audio/wavEncoder';
import { ApiError, type WindowResult } from '../types/monitoring';
import { createMockClient, type MockScenario } from './mockMonitoringClient';

const T0 = Date.parse('2026-10-16T07:00:00Z');
const audio = wavBlob(new Float32Array(48000), 16000);

async function stream(scenario: MockScenario, windows: number) {
  const c = createMockClient({ latencyScale: 0 });
  c.setScenario(scenario);
  const results: WindowResult[] = [];
  for (let i = 1; i <= windows; i++) {
    results.push(
      await c.analyzeWindow({
        audio,
        machine_id: 'fan_01',
        session_id: 'sess',
        sequence: i,
        recorded_at: new Date(T0 + i * 1000).toISOString(),
      }),
    );
  }
  return { c, results, alerts: results.filter((r) => r.alert.triggered) };
}

describe('mock monitoring client scenarios', () => {
  it('normal: stable low scores, valid signal, no alerts', async () => {
    const { results, alerts } = await stream('normal', 40);
    expect(alerts).toHaveLength(0);
    expect(results.every((r) => r.status === 'normal' && r.signal_quality === 'ok')).toBe(true);
    expect(results.every((r) => r.is_probability === false && r.anomaly_score! < r.threshold!)).toBe(true);
  });

  it('anomaly: sustained high scores raise exactly one alert', async () => {
    const { alerts, c } = await stream('anomaly', 60);
    expect(alerts).toHaveLength(1);
    const events = await c.events('sess');
    expect(events).toHaveLength(1);
    expect(events[0].ended_at).toBeNull();
  });

  it('transient_spike: isolated high windows never alert', async () => {
    const { results, alerts } = await stream('transient_spike', 40);
    expect(results.some((r) => r.status === 'anomaly')).toBe(true);
    expect(alerts).toHaveLength(0);
  });

  it('silence: unable to assess, with no score claimed', async () => {
    const { results } = await stream('silence', 5);
    expect(results.every((r) => r.status === 'unable_to_assess' && r.anomaly_score === null && r.signal_quality === 'silence')).toBe(true);
  });

  it('backend_offline: every route fails instead of returning a status', async () => {
    const c = createMockClient({ latencyScale: 0 });
    c.setScenario('backend_offline');
    await expect(c.health()).rejects.toBeInstanceOf(ApiError);
    await expect(
      c.analyzeWindow({ audio, machine_id: 'fan_01', session_id: 's', sequence: 1, recorded_at: new Date().toISOString() }),
    ).rejects.toThrow('Backend unreachable');
  });

  it('rejects unsupported profiles and empty audio like the real contract', async () => {
    const c = createMockClient({ latencyScale: 0 });
    const base = { session_id: 's', sequence: 1, recorded_at: new Date().toISOString() };
    await expect(c.analyzeWindow({ ...base, audio, machine_id: 'pump_99' })).rejects.toMatchObject({ status: 422 });
    await expect(c.analyzeWindow({ ...base, audio: new Blob([]), machine_id: 'fan_01' })).rejects.toMatchObject({ status: 422 });
  });

  it('acknowledging keeps the event open (acknowledgment is not repair)', async () => {
    const { c, alerts } = await stream('anomaly', 10);
    const ev = await c.acknowledge('sess', alerts[0].alert.event_id!);
    expect(ev.acknowledged_at).not.toBeNull();
    expect(ev.ended_at).toBeNull();
  });
});
