import { ChevronUp, Menu, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Workspace } from '../../types/monitoring';
import { Logo } from '../brand/Logo';

export interface AccountBlock {
  title: string; // e-mail, device name, "Guest"...
  subtitle: ReactNode; // role, countdown...
  actions: { label: string; onClick: () => void }[];
}

/** Workspaces listed like projects (one click opens one), with your account at the bottom. Slides in on phones. */
export function Sidebar({
  workspaces,
  currentId,
  currentName,
  onOpen,
  onCreate,
  account,
}: {
  workspaces: Workspace[] | null; // null: this browser is not signed in (guest, device, demo): just the current one
  currentId: string | null;
  currentName: string;
  onOpen: (w: Workspace) => void;
  onCreate?: (name: string) => Promise<void>;
  account: AccountBlock | null;
}) {
  const [open, setOpen] = useState(false); // phones
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list: Workspace[] = workspaces ?? (currentId ? [{ id: currentId, name: currentName, role: 'owner' }] : []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!onCreate || name.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim());
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const body = (
    <div className="flex h-full flex-col">
      <a href="/" aria-label="Machine Sound Monitor home" className="px-4 pt-4 pb-5">
        <Logo />
      </a>

      <div className="flex items-center justify-between px-4">
        <p className="eyebrow text-ink-faint">Workspaces</p>
        {onCreate && (
          <button
            type="button"
            aria-label="New workspace"
            onClick={() => setCreating((c) => !c)}
            className="grid size-7 place-items-center rounded-lg text-ink-faint hover:bg-surface-muted hover:text-ink"
          >
            <Plus aria-hidden className="size-4" />
          </button>
        )}
      </div>

      {creating && (
        <form onSubmit={create} className="mx-3 mt-2 grid gap-1.5">
          <input
            autoFocus
            aria-label="New workspace name"
            placeholder="e.g. Plant A"
            minLength={2}
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
            className="min-h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-sm"
          />
          <p className="px-0.5 text-[11px] text-ink-faint">{busy ? 'Creating…' : error ?? 'Press Enter to create'}</p>
        </form>
      )}

      <nav aria-label="Workspaces" className="mt-2 grid gap-0.5 overflow-y-auto px-2">
        {list.map((w) => {
          const current = w.id === currentId;
          const tone = (w.open_alerts ?? 0) > 0 ? 'bg-anomaly' : (w.listening ?? 0) > 0 ? 'bg-normal' : 'bg-line-strong';
          const status =
            (w.open_alerts ?? 0) > 0
              ? `${w.open_alerts} open alert${w.open_alerts === 1 ? '' : 's'}`
              : (w.listening ?? 0) > 0
                ? `${w.listening} listening`
                : w.devices !== undefined
                  ? `${w.devices} device${w.devices === 1 ? '' : 's'}`
                  : null;
          return (
            <button
              key={w.id}
              type="button"
              aria-current={current ? 'page' : undefined}
              onClick={() => (current ? setOpen(false) : onOpen(w))}
              className={`flex min-h-11 items-center gap-2.5 rounded-xl px-2.5 text-left ${current ? 'bg-surface shadow-sm ring-1 ring-line' : 'hover:bg-surface-muted'}`}
            >
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${tone}`} />
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm ${current ? 'font-semibold' : 'font-medium'}`}>{w.name}</span>
                {status && <span className="block truncate text-[11px] text-ink-faint">{status}</span>}
              </span>
            </button>
          );
        })}
      </nav>

      {account && <AccountMenu account={account} />}
    </div>
  );

  return (
    <>
      {/* Phones: a slim bar with the menu button */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-canvas/90 px-4 py-2.5 backdrop-blur lg:hidden">
        <button type="button" aria-label="Open menu" onClick={() => setOpen(true)} className="grid size-10 place-items-center rounded-full hover:bg-surface-muted">
          <Menu aria-hidden className="size-5" />
        </button>
        <span className="truncate text-sm font-semibold">{currentName}</span>
      </div>

      {/* Desktop: fixed on the left */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-line bg-canvas lg:block">{body}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-canvas shadow-2xl">
            <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="absolute top-3 right-3 grid size-9 place-items-center rounded-full hover:bg-surface-muted">
              <X aria-hidden className="size-4" />
            </button>
            {body}
          </aside>
        </div>
      )}
    </>
  );
}

function AccountMenu({ account }: { account: AccountBlock }) {
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
    <div ref={ref} className="relative mt-auto border-t border-line p-2">
      {open && (
        <div role="menu" className="absolute right-2 bottom-full left-2 mb-1 grid gap-0.5 rounded-2xl border border-line bg-surface p-1.5 shadow-xl">
          {account.actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              onClick={() => (setOpen(false), a.onClick())}
              className="min-h-10 rounded-xl px-3 text-left text-sm hover:bg-surface-muted"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-surface-muted"
      >
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-teal text-xs font-semibold text-white">
          {account.title.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-semibold">{account.title}</span>
          <span className="block truncate text-[11px] text-ink-faint">{account.subtitle}</span>
        </span>
        <ChevronUp aria-hidden className="size-4 shrink-0 text-ink-faint" />
      </button>
    </div>
  );
}
