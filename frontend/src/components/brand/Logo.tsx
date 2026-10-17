// A steady line (teal) hit by one sound that is different (the tall coral peak), ringing out in smaller peaks to
// the right; the flat line and the peak form a plus. Previous marks: git tags landing-v1-photo-hero (four bars),
// landing-v2-navy-logo (wave on a navy tile), and e963795 (teal waves into a coral four-point star).
export function LogoMark({ className = 'size-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <g fill="none" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 32H27M37 32L42 20L48 41L54 28L60 32" stroke="#1d5560" />
        <path d="M27 32L30 5L34 59L37 32" stroke="#ef6a52" />
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
