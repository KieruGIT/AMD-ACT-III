import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Button, Panel } from '../ui/primitives';

/**
 * The device's learned normal sound: a progress bar while it learns (its first minute of listening), then when it was
 * learned, with its own Re-learn button for admins.
 */
export function LearningCard({
  learning,
  learnedAt,
  onRelearn,
}: {
  learning: { windows: number; needed: number } | null | undefined;
  learnedAt: string | null | undefined;
  onRelearn?: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  if (!learning && !learnedAt) return null; // this scorer does not learn on site, or nothing heard yet
  const pct = learning ? Math.min(100, Math.round((learning.windows / Math.max(1, learning.needed)) * 100)) : 100;
  const relearn = onRelearn && (
    <Button
      className="min-h-9 gap-1.5 px-4 text-xs"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void onRelearn().finally(() => setBusy(false));
      }}
    >
      <RotateCcw aria-hidden className="size-3.5" />
      {learning ? 'Restart learning' : 'Re-learn normal sound'}
    </Button>
  );

  return (
    <Panel className="!p-4 sm:!p-5">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-0.5 text-sm">
            <p className="font-semibold">{learning ? 'Learning normal sound' : 'Normal sound learned'}</p>
            <p className="text-ink-muted">
              {learning
                ? `Keep the machine running as usual and the room quiet. ${learning.windows} of ${learning.needed} seconds.`
                : `Learned ${new Date(learnedAt!).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}. Re-learn after servicing or moving the microphone.`}
            </p>
          </div>
          {relearn}
        </div>
        {learning && (
          <div
            role="progressbar"
            aria-label="Learning normal sound"
            aria-valuemin={0}
            aria-valuemax={learning.needed}
            aria-valuenow={learning.windows}
            className="h-2 overflow-hidden rounded-full bg-surface-muted"
          >
            <div className="h-full rounded-full bg-teal transition-[width] duration-700" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </Panel>
  );
}
