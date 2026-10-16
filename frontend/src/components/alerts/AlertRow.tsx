import { Check, CircleAlert, History } from 'lucide-react';
import { useState } from 'react';
import type { AlertEvent, MachineProfile } from '../../types/monitoring';
import { formatDuration, formatScore, formatTime } from '../../lib/format';
import { Button, StatusChip } from '../ui/primitives';

export function AlertRow({
  event,
  profiles,
  now,
  onAcknowledge,
  compact = false,
}: {
  event: AlertEvent;
  profiles: MachineProfile[];
  now: number;
  onAcknowledge: (id: string) => Promise<void>;
  compact?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ongoing = event.ended_at === null;
  const end = ongoing ? now : Date.parse(event.ended_at!);
  const machine = profiles.find((p) => p.id === event.machine_id)?.label ?? event.machine_id;

  const ack = async () => {
    setPending(true);
    setError(null);
    try {
      await onAcknowledge(event.event_id);
    } catch (err) {
      setError(`Couldn't save acknowledgment: ${(err as Error).message}`);
    } finally {
      setPending(false);
    }
  };

  return (
    <li className={`enter rounded-[var(--radius-inner)] border p-4 ${ongoing ? 'border-anomaly/30 bg-anomaly-soft/50' : 'border-line bg-surface'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink">Persistent acoustic anomaly</p>
          <p className="num mt-0.5 text-xs text-ink-faint">
            {machine} · {formatTime(event.started_at)} · {formatDuration(end - Date.parse(event.started_at))}
            {ongoing ? ' so far' : ''}
          </p>
        </div>
        {ongoing ? (
          <StatusChip tone="anomaly" Icon={CircleAlert}>Ongoing</StatusChip>
        ) : (
          <StatusChip tone="neutral" Icon={History}>Recovered {formatTime(event.ended_at!)}</StatusChip>
        )}
      </div>

      <dl className="num mt-3 grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-ink-faint">Windows</dt><dd className="font-medium text-ink">{event.anomalous_window_count}</dd></div>
        <div><dt className="text-ink-faint">Peak score</dt><dd className="font-medium text-ink">{formatScore(event.peak_score)}</dd></div>
        <div><dt className="text-ink-faint">Threshold</dt><dd className="font-medium text-ink">{formatScore(event.threshold)}</dd></div>
      </dl>

      {!compact && (
        <>
          <p className="mt-3 text-xs text-ink-muted">Trigger: {event.reason}.</p>
          <p className="mt-1 text-xs text-ink-muted">
            {ongoing ? 'Recommended: inspect the machine and recheck. ' : ''}Evidence audio not retained (retention is off).
          </p>
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {event.acknowledged_at ? (
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted">
            <Check aria-hidden className="size-4 text-teal" />
            Acknowledged {formatTime(event.acknowledged_at)}. This does not mean it's resolved.
          </p>
        ) : (
          <Button onClick={ack} disabled={pending} className="min-h-10 px-4 text-xs">
            {pending ? 'Saving…' : 'Acknowledge'}
          </Button>
        )}
        {error && <p role="alert" className="text-xs text-anomaly">{error}</p>}
      </div>
    </li>
  );
}
