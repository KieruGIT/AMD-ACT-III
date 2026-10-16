import { BellRing, Cpu, Gauge, Mic } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AlertEvent } from '../../types/monitoring';
import type { AssessmentView, SessionState } from '../../lib/sessionReducer';
import { formatAgo, formatHz, formatTime } from '../../lib/format';
import type { Tone } from '../../lib/status';

const dot: Record<Tone, string> = {
  normal: 'bg-normal',
  warning: 'bg-warning',
  anomaly: 'bg-anomaly',
  unknown: 'bg-unknown',
  accent: 'bg-teal',
  neutral: 'bg-line-strong',
};

function Step({ n, icon, title, tone, value, detail, live }: {
  n: number; icon: ReactNode; title: string; tone: Tone; value: string; detail: string; live?: boolean;
}) {
  return (
    <li className="relative flex min-w-0 gap-3 rounded-[var(--radius-inner)] bg-surface p-3 sm:p-4">
      <span aria-hidden className="hidden size-9 shrink-0 place-items-center rounded-full bg-surface-muted text-ink-muted sm:grid">{icon}</span>
      <div className="min-w-0">
        <p className="eyebrow text-ink-faint">
          <span className="sr-only">Step {n}: </span>{title}
        </p>
        <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-ink">
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot[tone]} ${live ? 'live-dot text-teal' : ''}`} />
          <span className="truncate">{value}</span>
        </p>
        <p className="num mt-0.5 truncate text-xs text-ink-faint">{detail}</p>
      </div>
    </li>
  );
}

/**
 * The four distinct events the brief requires never to collapse into one indicator:
 * input connected → window processed → window score → sustained alert.
 */
export function SignalChain({
  state,
  view,
  now,
  activeEvent,
}: {
  state: SessionState;
  view: AssessmentView;
  now: number;
  activeEvent: AlertEvent | null;
}) {
  const capturing = !!state.source && (state.status === 'monitoring' || (state.status === 'interrupted' && state.error?.kind !== 'capture' && state.error?.kind !== 'permission'));
  const r = state.latest;
  const live = view !== 'stale' && view !== 'interrupted' && view !== 'stopped' && view !== 'idle';

  const input = capturing
    ? { tone: 'accent' as Tone, value: state.source!.kind === 'simulated' ? 'Simulated audio' : 'Microphone connected', detail: `${formatHz(state.source!.sampleRate)} · mono` }
    : { tone: 'neutral' as Tone, value: 'No input', detail: state.status === 'stopped' ? 'Capture stopped' : 'Not capturing' };

  const processed = state.status === 'interrupted' && state.error?.kind === 'backend'
    ? { tone: 'warning' as Tone, value: 'Service unreachable', detail: `${state.failures} failed request${state.failures === 1 ? '' : 's'}` }
    : r && state.lastResultAt
      ? { tone: (view === 'stale' ? 'warning' : live ? 'accent' : 'neutral') as Tone, value: `Window #${r.sequence}`, detail: `${formatTime(r.recorded_at)} · ${live ? formatAgo(now - state.lastResultAt) : 'not live'}${state.windowsSkipped ? ` · ${state.windowsSkipped} skipped` : ''}` }
      : { tone: 'neutral' as Tone, value: state.status === 'monitoring' ? 'Waiting for first window' : 'None yet', detail: 'One window per hop' };

  const score = !r || !live
    ? { tone: 'neutral' as Tone, value: live ? 'Pending' : 'No current score', detail: r ? 'Last result is not live' : '—' }
    : r.status === 'unable_to_assess'
      ? { tone: 'unknown' as Tone, value: 'Not assessable', detail: `Signal: ${r.signal_quality}` }
      : r.is_anomaly_window
        ? { tone: 'anomaly' as Tone, value: 'Above threshold', detail: 'Single window, not an alert' }
        : { tone: 'normal' as Tone, value: 'Below threshold', detail: 'Latest valid window' };

  const alert = activeEvent
    ? { tone: 'anomaly' as Tone, value: live ? 'Alert active' : 'Alert active (last known)', detail: `Since ${formatTime(activeEvent.started_at)} · ${activeEvent.anomalous_window_count} windows` }
    : { tone: 'neutral' as Tone, value: 'No active alert', detail: 'Aggregated by the backend' };

  return (
    <ol aria-label="Monitoring signal chain" className="grid grid-cols-2 gap-2 xl:grid-cols-4">
      <Step n={1} icon={<Mic className="size-4" />} title="Audio input" {...input} live={capturing && state.status === 'monitoring'} />
      <Step n={2} icon={<Cpu className="size-4" />} title="Window processed" {...processed} />
      <Step n={3} icon={<Gauge className="size-4" />} title="Window score" {...score} />
      <Step n={4} icon={<BellRing className="size-4" />} title="Sustained alert" {...alert} />
    </ol>
  );
}
