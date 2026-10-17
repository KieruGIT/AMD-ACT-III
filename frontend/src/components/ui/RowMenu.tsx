import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export interface RowAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
  current?: boolean; // e.g. the role a member already has
}

/** The "⋯" button on a list row: a short menu of actions for that row. */
export function RowMenu({ label, actions, disabled }: { label: string; actions: RowAction[]; disabled?: boolean }) {
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

  if (actions.length === 0) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="grid size-9 place-items-center rounded-full text-ink-faint hover:bg-surface-muted hover:text-ink disabled:opacity-50"
      >
        <MoreHorizontal aria-hidden className="size-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 grid w-48 gap-0.5 rounded-2xl border border-line bg-surface p-1.5 shadow-xl">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              aria-current={a.current || undefined}
              onClick={() => {
                setOpen(false);
                a.onClick();
              }}
              className={`min-h-9 rounded-xl px-3 text-left text-sm hover:bg-surface-muted ${a.danger ? 'text-anomaly' : ''} ${a.current ? 'font-semibold' : ''}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
