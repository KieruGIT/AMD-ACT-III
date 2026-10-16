import type { AlertEvent, ConfigResponse } from '../../types/monitoring';

// Mock of the BACKEND's alert aggregation (the real service owns this; the UI never invents alerts).
// Rules: an event fires when `min_anomalous_windows` of the last `consider_last_valid_windows` valid
// windows exceed threshold. One event spans an uninterrupted anomaly; it closes after that many
// consecutive normal windows, then a cooldown blocks new events. Long gaps reset the count.

export interface ObservedWindow {
  valid: boolean;
  isAnomaly: boolean;
  score: number | null;
  threshold: number | null;
  recordedAt: string;
  sessionId: string;
  machineId: string;
}

export interface AlertDecision {
  triggered: boolean;
  eventId: string | null;
  reason: string | null;
}

interface RecentWindow { anomaly: boolean; score: number | null; recordedAt: string }

export class AlertAggregator {
  readonly events: AlertEvent[] = [];
  private recent: RecentWindow[] = [];
  private lastValidAt: number | null = null;
  private normalStreak = 0;
  private cooldownUntil = -Infinity;
  private active: AlertEvent | null = null;
  private readonly policy: ConfigResponse['alert_policy'];
  private readonly newId: () => string;
  private readonly gapResetMs: number;

  constructor(policy: ConfigResponse['alert_policy'], newId: () => string, gapResetMs = 10_000) {
    this.policy = policy;
    this.newId = newId;
    this.gapResetMs = gapResetMs;
  }

  observe(w: ObservedWindow): AlertDecision {
    const none = { triggered: false, eventId: this.active?.event_id ?? null, reason: null };
    if (!w.valid) return none;

    const at = Date.parse(w.recordedAt);
    if (this.lastValidAt !== null && at - this.lastValidAt > this.gapResetMs) this.recent = [];
    this.lastValidAt = at;

    this.recent.push({ anomaly: w.isAnomaly, score: w.score, recordedAt: w.recordedAt });
    if (this.recent.length > this.policy.consider_last_valid_windows) this.recent.shift();

    if (this.active) {
      const ev = this.active;
      if (w.isAnomaly) {
        ev.anomalous_window_count += 1;
        ev.last_anomalous_at = w.recordedAt;
        ev.peak_score = Math.max(ev.peak_score, w.score ?? -Infinity);
        this.normalStreak = 0;
      } else if (++this.normalStreak >= this.policy.consider_last_valid_windows) {
        ev.ended_at = w.recordedAt;
        this.active = null;
        this.recent = [];
        this.normalStreak = 0;
        this.cooldownUntil = at + this.policy.cooldown_seconds * 1000;
      }
      return { triggered: false, eventId: ev.event_id, reason: null };
    }

    const anomalous = this.recent.filter((r) => r.anomaly);
    if (anomalous.length < this.policy.min_anomalous_windows || at < this.cooldownUntil) return none;

    const reason = `${anomalous.length} of the last ${this.recent.length} valid windows exceeded threshold`;
    const ev: AlertEvent = {
      event_id: this.newId(),
      session_id: w.sessionId,
      machine_id: w.machineId,
      started_at: anomalous[0].recordedAt,
      last_anomalous_at: w.recordedAt,
      ended_at: null,
      anomalous_window_count: anomalous.length,
      peak_score: Math.max(...anomalous.map((r) => r.score ?? -Infinity)),
      threshold: w.threshold ?? NaN,
      reason,
      acknowledged_at: null,
    };
    this.events.push(ev);
    this.active = ev;
    this.normalStreak = 0;
    return { triggered: true, eventId: ev.event_id, reason };
  }
}
