import { BellOff } from 'lucide-react';
import type { AlertEvent, MachineProfile } from '../../types/monitoring';
import { AlertRow } from './AlertRow';

export function AlertList({
  events,
  profiles,
  now,
  onAcknowledge,
  limit,
  compact,
}: {
  events: AlertEvent[];
  profiles: MachineProfile[];
  now: number;
  onAcknowledge: (id: string) => Promise<void>;
  limit?: number;
  compact?: boolean;
}) {
  if (events.length === 0) {
    return (
      <div className="grid place-items-center gap-2 rounded-[var(--radius-inner)] border border-dashed border-line-strong px-4 py-10 text-center">
        <BellOff aria-hidden className="size-5 text-ink-faint" />
        <p className="text-sm font-medium text-ink">No alerts in this session</p>
        <p className="max-w-56 text-xs text-ink-faint">An alert appears only after repeated anomalous windows, not single spikes.</p>
      </div>
    );
  }
  const sorted = [...events].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  return (
    <ul className="grid gap-3">
      {sorted.slice(0, limit).map((e) => (
        <AlertRow key={e.event_id} event={e} profiles={profiles} now={now} onAcknowledge={onAcknowledge} compact={compact} />
      ))}
    </ul>
  );
}
