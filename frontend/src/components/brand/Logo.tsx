// A steady machine hum with one burst that is different (the anomaly). Designed in Figma:
// "Machine Sound Monitor — Brand" → Logo / Mark. Previous mark (four bars): git tag landing-v1-photo-hero.
export function LogoMark({ className = 'size-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="16" fill="#111e3b" />
      <g fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 32Q12 27 15 32T21 32T26 32M38 32Q41 27 44 32T50 32T55 32" stroke="#7f8ba3" />
        <path d="M26 32Q29 12 32 32T38 32" stroke="#e5654e" />
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
