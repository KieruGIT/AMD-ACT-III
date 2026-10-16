const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const tzFmt = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' });

export const formatTime = (iso: string | number) => timeFmt.format(new Date(iso));

/** Local time-zone label, e.g. "GMT+8". */
export const timeZoneLabel = () =>
  tzFmt.formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? 'local time';

export const formatScore = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? '—' : v.toFixed(3));

export function formatDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

export function formatAgo(ms: number) {
  if (ms < 1500) return 'just now';
  return `${formatDuration(ms)} ago`;
}

export const formatHz = (hz: number) => (hz >= 1000 ? `${+(hz / 1000).toFixed(1)} kHz` : `${hz} Hz`);
