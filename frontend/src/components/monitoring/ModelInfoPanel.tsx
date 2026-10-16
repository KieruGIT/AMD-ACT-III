import type { BackendInfo } from '../../hooks/useMonitoringSession';
import type { SessionState } from '../../lib/sessionReducer';
import { formatHz } from '../../lib/format';

function Row({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-line py-2.5 text-sm last:border-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="num text-right font-medium text-ink">{value}</dd>
      {note && <dd className="col-span-2 text-xs text-ink-faint">{note}</dd>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="eyebrow mb-1 text-ink-faint">{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

const NOT_MEASURED = <span className="text-ink-faint">Not measured</span>;

export function ModelInfoPanel({ backend, state, mode }: { backend: BackendInfo; state: SessionState; mode: 'mock' | 'live' }) {
  const { health, config } = backend;
  const r = state.latest;
  return (
    <div>
      {mode === 'mock' && (
        <p className="mb-5 rounded-[var(--radius-inner)] border border-dashed border-teal/60 bg-teal-soft p-3 text-sm text-teal">
          Simulation: every score, latency and model value below comes from the in-browser mock backend, not a trained model or GPU.
        </p>
      )}

      <Section title="Service">
        <Row label="Service" value={health?.service ?? (backend.error ? 'Unreachable' : '—')} />
        <Row label="Model ready" value={health ? (health.model_ready ? 'Yes' : 'No') : '—'} />
        <Row label="Mode" value={health?.mode ?? '—'} />
        <Row label="Model version" value={health?.model_version ?? '—'} />
        <Row label="Accelerator" value={<span className="text-ink-faint">Not reported by backend</span>} note="AMD GPU details are shown only when deployment metadata provides them." />
      </Section>

      <Section title="Input contract">
        <Row label="Contract version" value={config?.contract_version ?? '—'} />
        <Row label="Model sample rate" value={config ? formatHz(config.input.sample_rate_hz) : '—'} />
        <Row label="Capture sample rate" value={state.source ? formatHz(state.source.sampleRate) : '—'} note="Sent at the native rate; the backend resamples (proposed integration rule)." />
        <Row label="Window / hop" value={config ? `${config.input.window_ms / 1000} s / ${config.input.hop_ms / 1000} s` : '—'} />
        <Row label="Format" value={config?.input.format ?? '—'} />
        <Row label="Profiles" value={config?.supported_profiles.map((p) => p.id).join(', ') || '—'} />
      </Section>

      <Section title="Score & alert policy">
        <Row label="Score" value={config?.score.name.replace(/_/g, ' ') ?? '—'} note="Higher means more anomalous. Not a probability." />
        <Row
          label="Alert rule"
          value={config ? `${config.alert_policy.min_anomalous_windows} of last ${config.alert_policy.consider_last_valid_windows} windows` : '—'}
        />
        <Row label="Cooldown" value={config ? `${config.alert_policy.cooldown_seconds} s` : '—'} />
      </Section>

      <Section title="Measured this session">
        <Row label="Model inference" value={r?.processing.model_ms != null ? `${r.processing.model_ms} ms` : NOT_MEASURED} />
        <Row label="Server processing" value={r?.processing.server_ms != null ? `${r.processing.server_ms} ms` : NOT_MEASURED} />
        <Row label="End-to-end round trip" value={state.roundTripMs != null ? `${state.roundTripMs} ms` : NOT_MEASURED} />
        <Row label="Windows sent / skipped" value={`${state.windowsSent} / ${state.windowsSkipped}`} />
      </Section>

      <Section title="Benchmark">
        <Row label="ROC AUC / pAUC" value={NOT_MEASURED} note="Filled in from the held-out evaluation report (dataset, split, date) once the model is trained." />
      </Section>

      <p className="text-xs leading-relaxed text-ink-faint">
        Experimental acoustic anomaly detector. Not a certified safety system, fault diagnosis or failure prediction. Alerts
        call for human inspection; the system never controls equipment.
      </p>
    </div>
  );
}
