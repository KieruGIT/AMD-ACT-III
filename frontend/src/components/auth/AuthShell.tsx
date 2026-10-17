import type { ReactNode } from 'react';
import { Logo } from '../brand/Logo';

/** Full reload so the console starts with the access this browser just chose. */
export function go(path: string) {
  location.assign(path);
}

export function AuthShell({ title, intro, children, aside }: { title: string; intro?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-[1440px] items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <a href="/" aria-label="Machine Sound Monitor home">
          <Logo />
        </a>
        {aside}
      </header>
      <main className="grid flex-1 place-items-center px-4 pt-6 pb-16">
        <div className="w-full max-w-md">
          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-balance">{title}</h1>
          {intro && <p className="mt-2 text-sm leading-relaxed text-ink-muted">{intro}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}

export function Field({ label, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      <input
        {...props}
        className={`min-h-11 rounded-xl border border-line-strong bg-surface px-3 text-sm outline-none focus:border-teal focus:ring-2 focus:ring-teal/20 ${props.className ?? ''}`}
      />
      {hint && <span className="text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-xl bg-anomaly-soft px-3 py-2 text-sm text-anomaly">
      {children}
    </p>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="status" className="rounded-xl bg-teal-soft px-3 py-2 text-sm text-teal">
      {children}
    </p>
  );
}
