import { Logo } from '../brand/Logo';
export type DrawerId = 'alerts' | 'model' | 'settings';

const NAV: { id: DrawerId; label: string }[] = [
  { id: 'alerts', label: 'Alert history' },
  { id: 'model', label: 'Model & system' },
  { id: 'settings', label: 'Settings' },
];

export function AppHeader({
  openAlerts,
  onOpen,
}: {
  openAlerts: number;
  onOpen: (id: DrawerId) => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6 lg:px-8">
        <a href="/" aria-label="Machine Sound Monitor home">
          <Logo subtitle="Experimental acoustic anomaly detection" />
        </a>

        <nav aria-label="Panels" className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto xl:order-none xl:mx-0 xl:ml-auto xl:w-auto">
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

      </div>
    </header>
  );
}
