// A steady machine hum (teal waves) running into the one sound that is different (the coral four-point star).
// Previous marks: git tags landing-v1-photo-hero (four bars) and landing-v2-navy-logo (wave on a navy tile).
export function LogoMark({ className = 'size-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <path
        d="M3 32Q7 25 11 32T19 32M61 32Q57 25 53 32T45 32"
        fill="none"
        stroke="#1d5560"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M32 5Q35 29 46 32Q35 35 32 59Q29 35 18 32Q29 29 32 5Z" fill="#ef6a52" stroke="#ef6a52" strokeWidth="2" strokeLinejoin="round" />
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
