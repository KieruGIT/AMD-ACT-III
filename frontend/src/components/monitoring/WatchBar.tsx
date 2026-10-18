import { MonitorSmartphone } from 'lucide-react';
import type { ProjectOverview } from '../../types/monitoring';
import { formatAgo } from '../../lib/format';

const ONLINE_MS = 10_000;

/** Watcher controls: pick which listening device in the project to follow. */
export function WatchBar({
  overview,
  error,
  deviceId,
  onSelect,
  now,
  onAddDevice,
}: {
  overview: ProjectOverview | null;
  error: string | null;
  deviceId: string | null;
  onSelect: (id: string) => void;
  now: number;
  onAddDevice?: () => void;
}) {
  if (error && !overview) {
    return <p role="alert" className="text-sm text-anomaly">Can't load the workspace: {error}.</p>;
  }
  if (!overview) return <p className="text-sm text-ink-faint">Loading project…</p>;
  const devices = overview.devices.filter((d) => !d.pending); // waiting for approval: nothing to watch yet
  if (devices.length === 0) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5 text-sm">
          <p className="font-semibold">No listening devices in {overview.name} yet.</p>
          <p className="text-ink-muted">
            {onAddDevice ? 'Use Add device above to pair a phone, laptop or sensor placed next to the machine.' : 'Ask a workspace admin to pair one.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow text-ink-faint">Watching workspace · {overview.name}</p>
        <p className="text-xs text-ink-faint">Audio stays on the listening device; this screen receives scores and alerts.</p>
      </div>
      <ul role="radiogroup" aria-label="Listening device" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {devices.map((d) => {
          const seen = d.last_seen_at ? now - Date.parse(d.last_seen_at) : Infinity;
          const online = seen < ONLINE_MS;
          const selected = d.id === deviceId;
          return (
            <li key={d.id}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onSelect(d.id)}
                className={`flex h-14 w-full items-center gap-3 rounded-2xl border px-4 text-left transition-colors ${
                  selected ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface hover:bg-surface-muted'
                }`}
              >
                <MonitorSmartphone aria-hidden className="size-5 shrink-0 opacity-80" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{d.name}</span>
                  <span className={`block truncate text-xs ${selected ? 'text-white/70' : 'text-ink-faint'}`}>
                    {d.machine_id} · {online ? 'listening now' : d.last_seen_at ? `last seen ${formatAgo(seen)}` : 'never connected'}
                  </span>
                </span>
                <span aria-hidden className={`size-2 shrink-0 rounded-full ${online ? 'live-dot bg-normal text-normal' : 'bg-line-strong'}`} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
