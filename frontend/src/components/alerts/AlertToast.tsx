import { BellRing, X } from 'lucide-react';
import { useEffect } from 'react';
import type { AlertEvent } from '../../types/monitoring';
import { formatTime } from '../../lib/format';

/** One non-blocking notification per newly triggered event. */
export function AlertToast({
  event,
  machineLabel,
  onView,
  onDismiss,
}: {
  event: AlertEvent | null;
  machineLabel: string;
  onView: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!event) return;
    const t = setTimeout(onDismiss, 10_000);
    return () => clearTimeout(t);
  }, [event, onDismiss]);

  return (
    <div aria-live="assertive" className="pointer-events-none fixed inset-x-4 bottom-4 z-40 flex justify-end sm:inset-x-auto sm:top-20 sm:right-6 sm:bottom-auto">
      {event && (
        <div role="alert" className="enter pointer-events-auto flex w-full max-w-sm gap-3 rounded-2xl bg-navy p-4 text-on-dark shadow-2xl ring-1 ring-anomaly-on-dark/40">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-anomaly-on-dark/15 text-anomaly-on-dark">
            <BellRing className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Persistent acoustic anomaly</p>
            <p className="num mt-0.5 text-xs text-on-dark-muted">
              {machineLabel} · since {formatTime(event.started_at)} · {event.reason}
            </p>
            <button type="button" onClick={onView} className="mt-2 text-xs font-semibold text-on-dark underline underline-offset-4">
              Review alert
            </button>
          </div>
          <button type="button" onClick={onDismiss} aria-label="Dismiss notification" className="grid size-8 shrink-0 place-items-center rounded-full text-on-dark-muted hover:bg-on-dark/10">
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
