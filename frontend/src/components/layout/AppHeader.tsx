import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Logo } from '../brand/Logo';
export type DrawerId = 'alerts' | 'model' | 'settings' | 'workspace' | 'devices';

const NAV: { id: DrawerId; label: string }[] = [
  { id: 'alerts', label: 'Alert history' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'model', label: 'Model & system' },
  { id: 'settings', label: 'Settings' },
];

export interface AccountMenu {
  title: string; // workspace name
  subtitle: string; // role / access, e.g. "Owner" or "Listening device"
  actions: { label: string; onClick: () => void }[];
}

export function AppHeader({
  openAlerts,
  onOpen,
  canManage = false,
  account,
}: {
  openAlerts: number;
  onOpen: (id: DrawerId) => void;
  canManage?: boolean;
  account?: AccountMenu | null;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6 lg:px-8">
        <a href="/" aria-label="Machine Sound Monitor home">
          <Logo />
        </a>

        <nav aria-label="Panels" className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto xl:order-none xl:mx-0 xl:ml-auto xl:w-auto">
          <span aria-current="page" className="inline-flex min-h-10 shrink-0 items-center rounded-full whitespace-nowrap bg-ink px-4 text-sm font-medium text-white">
            Live monitoring
          </span>
          {NAV.filter((n) => n.id !== 'workspace' || canManage).map((n) => (
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

        {account && <AccountButton account={account} />}
      </div>
    </header>
  );
}

function AccountButton({ account }: { account: AccountMenu }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative ml-auto xl:ml-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-10 max-w-60 items-center gap-2 rounded-full border border-line-strong bg-surface py-1 pr-3 pl-1.5 text-left hover:bg-surface-muted"
      >
        <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-teal text-xs font-semibold text-white">
          {account.title.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-semibold">{account.title}</span>
          <span className="block truncate text-[11px] text-ink-faint">{account.subtitle}</span>
        </span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-ink-faint" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 grid w-56 gap-0.5 rounded-2xl border border-line bg-surface p-1.5 shadow-xl">
          {account.actions.map((a) => (
            <MenuItem key={a.label} onClick={() => (setOpen(false), a.onClick())}>
              {a.label}
            </MenuItem>
          ))}
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="min-h-10 rounded-xl px-3 text-left text-sm hover:bg-surface-muted">
      {children}
    </button>
  );
}
