import type { AlertEvent, ConfigResponse } from '../../types/monitoring';
import type { AssessmentView, SessionState } from '../../lib/sessionReducer';
import { formatDuration, formatScore, formatTime, timeZoneLabel } from '../../lib/format';
import { ASSESSMENT, QUALITY_LABEL } from '../../lib/status';
import { StatusChip } from '../ui/primitives';

const wordColor: Record<AssessmentView, string> = {
  idle: 'text-on-dark',
  initializing: 'text-on-dark',
  normal: 'text-normal-on-dark',
  anomaly: 'text-anomaly-on-dark',
  unable_to_assess: 'text-unknown-on-dark',
  interrupted: 'text-warning-on-dark',
  stale: 'text-warning-on-dark',
  stopped: 'text-on-dark-muted',
};

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-on-dark-muted">{label}</dt>
      <dd className="num mt-0.5 truncate text-sm font-medium text-on-dark">{value}</dd>
    </div>
  );
}

export function AssessmentCard({
  view,
  state,
  config,
  activeEvent,
  now,
}: {
  view: AssessmentView;
  state: SessionState;
  config: ConfigResponse | null;
  activeEvent: AlertEvent | null;
  now: number;
}) {
  const meta = ASSESSMENT[view];
  const r = state.latest;
  // Score values are only shown as current while the reading is live.
  const live = view === 'normal' || view === 'anomaly' || view === 'unable_to_assess';
  const historical = r && !live && view !== 'idle';
  const delta = r?.anomaly_score != null && r.threshold != null ? r.anomaly_score - r.threshold : null;
  const windowS = config ? config.input.window_ms / 1000 : null;

  return (
    <section
      aria-labelledby="assessment-title"
      className="on-dark relative flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] bg-navy p-6 text-on-dark sm:p-7"
    >
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-teal/40 blur-3xl" />

      <div className="relative flex items-start justify-between gap-3">
        <p id="assessment-title" className="eyebrow whitespace-nowrap text-on-dark-muted">Current assessment</p>
        <StatusChip dark tone={meta.tone} Icon={meta.Icon}>{meta.short}</StatusChip>
      </div>

      <div className="relative mt-6" role="status" aria-live="polite" aria-atomic="true" data-testid="assessment">
        <p className={`text-[clamp(2.25rem,4vw,3.4rem)] leading-[0.95] font-semibold tracking-[-0.035em] text-balance ${wordColor[view]}`}>
          {meta.label}
        </p>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-on-dark-muted">
          {activeEvent && view === 'normal'
            ? 'This window is below the threshold, but the open alert stays active until several consecutive normal windows confirm recovery.'
            : view === 'unable_to_assess' && r?.note
              ? `Not assessed: ${r.note}.`
              : meta.description}
        </p>
      </div>

      <div className="relative mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-[var(--radius-inner)] bg-navy-raised p-4">
          <p className="text-[11px] text-on-dark-muted">{historical ? 'Last score (not live)' : 'Anomaly score'}</p>
          <p className={`num mt-1 text-3xl font-semibold tracking-tight ${historical ? 'text-on-dark-muted' : ''}`}>
            {formatScore(r?.anomaly_score)}
          </p>
          <p className="mt-1 truncate text-[11px] text-on-dark-muted">{(r?.score_unit ?? config?.score.name ?? 'score').replace(/_/g, ' ')}</p>
        </div>
        <div className="rounded-[var(--radius-inner)] bg-navy-raised p-4">
          <p className="text-[11px] text-on-dark-muted">Threshold</p>
          <p className="num mt-1 text-3xl font-semibold tracking-tight text-on-dark-muted">{formatScore(r?.threshold)}</p>
          <p className="num mt-1 truncate text-[11px] text-on-dark-muted">
            {delta === null ? 'profile-calibrated' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(3)} ${delta > 0 ? 'above' : 'below'}`}
          </p>
        </div>
      </div>

      <div className={`relative mt-3 rounded-[var(--radius-inner)] p-4 ${activeEvent ? 'bg-anomaly-on-dark/15 ring-1 ring-anomaly-on-dark/40' : 'bg-navy-raised'}`}>
        <p className="text-[11px] text-on-dark-muted">Sustained alert (backend aggregated)</p>
        {activeEvent ? (
          <>
            <p className="mt-1 text-sm font-semibold text-anomaly-on-dark">Persistent acoustic anomaly, ongoing</p>
            <p className="num mt-0.5 text-xs text-on-dark-muted">
              Since {formatTime(activeEvent.started_at)} · {formatDuration(now - Date.parse(activeEvent.started_at))} ·{' '}
              {activeEvent.anomalous_window_count} windows. Inspect the machine and recheck.
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm font-medium">None active</p>
        )}
      </div>

      <div aria-hidden className="min-h-6 flex-1" />
      <dl className="relative grid grid-cols-2 gap-x-4 gap-y-3 border-t border-navy-line pt-5 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4">
        <Cell label="Signal quality" value={r ? QUALITY_LABEL[r.signal_quality] : '—'} />
        <Cell label="Window" value={r ? `${formatTime(r.recorded_at)}` : windowS ? `${windowS} s` : '—'} />
        <Cell label="Model latency" value={r?.processing.model_ms != null ? `${r.processing.model_ms} ms` : '—'} />
        <Cell label="Round trip" value={state.roundTripMs != null ? `${state.roundTripMs} ms` : '—'} />
      </dl>
      <p className="relative mt-3 text-[11px] text-on-dark-muted">
        Times in {timeZoneLabel()}. Window = end of a {windowS ?? '?'} s capture. Score is not a probability.
      </p>
    </section>
  );
}
