import { CircleAlert, EyeOff, MicOff, Unplug } from 'lucide-react';
import type { SessionState } from '../../lib/sessionReducer';
import { Button } from '../ui/primitives';

/** Actionable explanation for whatever is preventing a live assessment. */
export function StatusBanner({
  state,
  backendError,
  onRetryBackend,
  onRetryStart,
  onUseDemo,
}: {
  state: SessionState;
  backendError: string | null;
  onRetryBackend: () => void;
  onRetryStart: () => void;
  onUseDemo: () => void;
}) {
  const e = state.error;

  if (backendError && !state.source) {
    return (
      <Banner tone="warning" icon={<Unplug className="size-5" />} title="Can't reach the analysis service">
        <p>Configuration could not be loaded ({backendError}). Monitoring can't start without the service's window and threshold settings.</p>
        <div className="mt-3 flex flex-wrap gap-2"><Button onClick={onRetryBackend}>Retry connection</Button></div>
      </Banner>
    );
  }
  if (!e) return null;

  if (e.kind === 'permission' || e.kind === 'no_device' || (e.kind === 'capture' && state.status !== 'interrupted')) {
    return (
      <Banner tone="anomaly" icon={<MicOff className="size-5" />} title={e.kind === 'no_device' ? 'No microphone found' : e.kind === 'permission' ? 'Microphone access blocked' : 'Microphone unavailable'}>
        <p>{e.message}</p>
        {e.kind === 'permission' && (
          <p className="mt-1">To allow it: click the site icon left of the address bar, open <em>Site settings</em> → <em>Microphone</em> → <em>Allow</em>, then start again.</p>
        )}
        {e.kind === 'no_device' && <p className="mt-1">Connect a microphone or choose another input in Settings.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={onRetryStart}>Try again</Button>
          <Button variant="primary" onClick={onUseDemo}>Try demo audio instead</Button>
        </div>
      </Banner>
    );
  }
  if (e.kind === 'backend') {
    return (
      <Banner tone="warning" icon={<Unplug className="size-5" />} title="Monitoring interrupted: analysis service unreachable">
        <p>No assessment is shown until the service responds. The next window is retried automatically ({state.failures} failed so far).</p>
      </Banner>
    );
  }
  if (e.kind === 'hidden') {
    return (
      <Banner tone="warning" icon={<EyeOff className="size-5" />} title="Monitoring interrupted while the tab was hidden">
        <p>{e.message} Status returns to live when the next result arrives. Keep this tab visible for continuous monitoring.</p>
      </Banner>
    );
  }
  return (
    <Banner tone="warning" icon={<CircleAlert className="size-5" />} title="Monitoring interrupted: audio input lost">
      <p>{e.message} Stop and start monitoring again once the input is available.</p>
    </Banner>
  );
}

function Banner({ tone, icon, title, children }: { tone: 'warning' | 'anomaly'; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  const cls = tone === 'anomaly' ? 'border-anomaly/30 bg-anomaly-soft' : 'border-warning/30 bg-warning-soft';
  const ic = tone === 'anomaly' ? 'text-anomaly' : 'text-warning';
  return (
    <div role="alert" className={`enter flex gap-3 rounded-[var(--radius-inner)] border p-4 text-sm text-ink ${cls}`}>
      <span aria-hidden className={`mt-0.5 shrink-0 ${ic}`}>{icon}</span>
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        <div className="mt-1 text-ink-muted">{children}</div>
      </div>
    </div>
  );
}
