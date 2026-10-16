import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Tone } from '../../lib/status';

const chipTone: Record<Tone, string> = {
  normal: 'bg-normal-soft text-normal',
  warning: 'bg-warning-soft text-warning',
  anomaly: 'bg-anomaly-soft text-anomaly',
  unknown: 'bg-unknown-soft text-unknown',
  accent: 'bg-teal-soft text-teal',
  neutral: 'bg-surface-muted text-ink-muted',
};

const chipToneDark: Record<Tone, string> = {
  normal: 'bg-normal-on-dark/15 text-normal-on-dark',
  warning: 'bg-warning-on-dark/15 text-warning-on-dark',
  anomaly: 'bg-anomaly-on-dark/15 text-anomaly-on-dark',
  unknown: 'bg-unknown-on-dark/15 text-unknown-on-dark',
  accent: 'bg-on-dark/10 text-on-dark',
  neutral: 'bg-on-dark/10 text-on-dark-muted',
};

export function StatusChip({
  tone,
  Icon,
  children,
  dark = false,
  size = 'sm',
}: {
  tone: Tone;
  Icon?: LucideIcon;
  children: ReactNode;
  dark?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap ${
        size === 'md' ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-xs'
      } ${(dark ? chipToneDark : chipTone)[tone]}`}
    >
      {Icon && <Icon aria-hidden className={size === 'md' ? 'size-4' : 'size-3.5'} strokeWidth={2.2} />}
      {children}
    </span>
  );
}

export function Panel({
  title,
  eyebrow,
  actions,
  children,
  className = '',
  labelledBy,
}: {
  title?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={`rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6 ${className}`}
    >
      {(title || eyebrow || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow text-ink-faint">{eyebrow}</p>}
            {title && (
              <h2 id={labelledBy} className="mt-1 text-lg font-semibold tracking-tight text-ink text-balance">
                {title}
              </h2>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

const buttonVariants = {
  primary: 'bg-teal text-white hover:bg-teal-strong',
  danger: 'bg-ink text-white hover:bg-navy-raised',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-muted',
  ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
} as const;

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonVariants }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${buttonVariants[variant]} ${className}`}
    />
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="num mt-0.5 truncate text-sm font-medium text-ink">{value}</dd>
      {hint && <dd className="text-xs text-ink-faint">{hint}</dd>}
    </div>
  );
}
