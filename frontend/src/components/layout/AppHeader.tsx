import { FlaskConical, Radio } from 'lucide-react';

export type DrawerId = 'alerts' | 'model' | 'settings';

const NAV: { id: DrawerId; label: string }[] = [
  { id: 'alerts', label: 'Alert history' },
  { id: 'model', label: 'Model & system' },
  { id: 'settings', label: 'Settings' },
];

export function AppHeader({
  mode,
  openAlerts,
  onOpen,
}: {
  mode: 'mock' | 'live';
  openAlerts: number;
  onOpen: (id: DrawerId) => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid size-9 place-items-center rounded-xl bg-navy text-on-dark">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2" />
            </svg>
          </span>
          <div className="leading-tight">
            <p className="text-[15px] font-semibold tracking-tight">Machine Sound Monitor</p>
            <p className="text-xs text-ink-faint">Experimental acoustic anomaly detection</p>
          </div>
        </div>

        <nav aria-label="Panels" className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto lg:order-none lg:mx-0 lg:w-auto lg:flex-1 lg:justify-center">
          <span aria-current="page" className="inline-flex min-h-10 shrink-0 items-center rounded-full whitespace-nowrap bg-ink px-4 text-sm font-medium text-white">
            Live monitoring
          </span>
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => onOpen(n.id)}
              className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full whitespace-nowrap px-4 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"
            >
              {n.label}
              {n.id === 'alerts' && openAlerts > 0 && (
                <span className="num grid min-w-5 place-items-center rounded-md bg-anomaly px-1 text-[11px] font-semibold text-white">
                  {openAlerts}
                  <span className="sr-only"> ongoing</span>
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="ml-auto lg:ml-0">
          {mode === 'mock' ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-dashed border-teal/60 bg-teal-soft px-3 py-1.5 text-xs font-semibold text-teal">
              <FlaskConical aria-hidden className="size-3.5" />
              Simulation · mock backend
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-navy px-3 py-1.5 text-xs font-semibold text-on-dark">
              <Radio aria-hidden className="size-3.5" />
              Live model
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
