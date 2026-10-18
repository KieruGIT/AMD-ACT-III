// A machine's steady hum (teal wave, balanced on both sides) crossed by one sound that is different: the coral peak,
// a slanted diamond whose top tip is the highest point and bottom tip the lowest. The wave thickens toward the
// middle and thins at the ends, so the whole mark reads as a plus with a diamond-star look. Drawn as filled
// outlines (variable width). Previous marks: git tags landing-v1-photo-hero (four bars), landing-v2-navy-logo
// (wave on a navy tile); commits e963795 (four-point star), f85a5e0 (plus with sharp peaks).
const WAVE = 'M2.4 32l.1-.4l.2-.2l1.5-.7l1.5-.9l0 .1l.3-.1l.4 .2l.1-.1l.7 .6l3.4 2.3l1.4-3.2l3-6l.7-.6l.4-.1l.8 0l.5 .1l.6 .6l2.4 5.7l1.4 3.6l.9 2.8l3.3-5.7l.4-.6l.1 0l.2-.2l.8-.7l1-.4l1-.1l1 .1l1 .4l.5 .4l6.1-5.3l.7-.7l.8-.6l.8-.9l.5-.3l.5-.2l.6-.1l.6 .1l.5 .2l.5 .3l.5 .9l1.7 4.5l2.3 8.2l3.3-5.3l.8-1l.5-.4l.6 0l.5 .4l2 1.7l.6 .7l1.8 1.5l1-.4l1.7-.9l.6 .1l.3 .4l0 .4l-.3 .4l-1.7 .7l-1.5 .9l0-.1l-.3 .1l-.4-.2l-.1 .1l-.7-.6l-3.3-2.3l-1.5 3.2l-3 6l-.6 .6l-.5 .1l-.8 0l-.4-.1l-.7-.6l-2.4-5.7l-1.4-3.6l-.9-2.8l-3.3 5.7l-.4 .6l-.1 0l-.2 .2l-.8 .7l-1 .4l-1 .1l-1-.1l-1-.4l-.5-.4l-6.1 5.3l-.7 .7l-.8 .6l-.8 .9l-.5 .3l-.5 .2l-.6 .1l-.6-.1l-.5-.2l-.5-.3l-.5-.9l-1.7-4.5l-2.3-8.2l-3.3 5.3l-.8 1l-.5 .4l-.6 0l-.5-.4l-2-1.7l-.6-.7l-1.8-1.5l-1 .4l-1.5 .9l-.5-.1l-.4-.4z';
const PEAK = 'M30.2 4Q33.6 22.2 38.5 32Q34.9 41.8 33.8 60Q30.4 41.8 25.5 32Q29.1 22.2 30.2 4Z';

export function LogoMark({ className = 'size-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <path fill="#1d5560" d={WAVE} />
      <path fill="#ef6a52" d={PEAK} />
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
