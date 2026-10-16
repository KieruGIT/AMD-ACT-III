// Four sound levels; the coral one is the sound that is different.
export function LogoMark({ className = 'size-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="16" fill="#111e3b" />
      <g strokeWidth="7" strokeLinecap="round">
        <path d="M15 27v10M26.3 21v22M49 25v14" stroke="#eef2f7" />
        <path d="M37.7 14v36" stroke="#e5654e" />
      </g>
    </svg>
  );
}

export function Logo({ subtitle, hideNameOnTiny }: { subtitle?: string; hideNameOnTiny?: boolean }) {
  return (
    <span className="flex items-center gap-3">
      <LogoMark className="size-9 shrink-0" />
      <span className={`leading-tight ${hideNameOnTiny ? 'max-[400px]:hidden' : ''}`}>
        <span className="block text-[15px] font-semibold tracking-tight whitespace-nowrap">Machine Sound Monitor</span>
        {subtitle && <span className="hidden text-xs text-ink-faint sm:block">{subtitle}</span>}
      </span>
    </span>
  );
}
