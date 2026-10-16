import { useEffect, useRef, useState } from 'react';
import type { SeriesPoint } from '../../lib/sessionReducer';
import { formatScore, formatTime } from '../../lib/format';
import { QUALITY_LABEL } from '../../lib/status';

const H = 220;
const PAD = { top: 14, right: 16, bottom: 26, left: 46 };

export function AnomalyTrendChart({ series, scoreName }: { series: SeriesPoint[]; scoreName: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [focus, setFocus] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scores = series.map((p) => p.score).filter((v): v is number => v !== null);
  const threshold = [...series].reverse().find((p) => p.threshold !== null)?.threshold ?? null;
  const yMax = Math.max(threshold ? threshold * 1.45 : 1, ...scores.map((s) => s * 1.08));
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slots = Math.max(30, series.length);
  const x = (i: number) => PAD.left + (innerW * (i + slots - series.length + 0.5)) / slots;
  const y = (v: number) => PAD.top + innerH * (1 - v / yMax);

  // Break the line at gaps (failed/skipped windows) and unassessable windows.
  const segments: string[] = [];
  let cur = '';
  series.forEach((p, i) => {
    if (p.score === null || p.gapBefore) {
      if (cur) segments.push(cur);
      cur = '';
    }
    if (p.score !== null) cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`;
  });
  if (cur) segments.push(cur);

  const yTicks = [0, yMax / 3, (2 * yMax) / 3, yMax];
  const timeTicks = [...new Set(series.length ? [0, Math.floor(series.length / 2), series.length - 1] : [])];
  const latest = series[series.length - 1];
  const f = focus !== null ? series[focus] : null;

  const pick = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || !series.length) return;
    const rel = ((clientX - rect.left - PAD.left) / innerW) * slots - (slots - series.length) - 0.5;
    setFocus(Math.max(0, Math.min(series.length - 1, Math.round(rel))));
  };

  return (
    <div>
      <div
        ref={wrapRef}
        className="relative rounded-[var(--radius-inner)] outline-offset-4"
        tabIndex={series.length ? 0 : -1}
        role="group"
        aria-label="Anomaly score trend. Use left and right arrow keys to inspect windows."
        onMouseMove={(e) => pick(e.clientX)}
        onMouseLeave={() => setFocus(null)}
        onBlur={() => setFocus(null)}
        onKeyDown={(e) => {
          if (!series.length) return;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            const d = e.key === 'ArrowLeft' ? -1 : 1;
            setFocus((i) => Math.max(0, Math.min(series.length - 1, (i ?? series.length - 1) + (i === null ? 0 : d))));
          }
          if (e.key === 'Escape') setFocus(null);
        }}
      >
        <svg width={width} height={H} className="block max-w-full" aria-hidden>
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="#e0ddd5" />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="num fill-ink-faint text-[11px]">
                {t.toFixed(2)}
              </text>
            </g>
          ))}

          {threshold !== null && (
            <g>
              <rect x={PAD.left} y={PAD.top} width={innerW} height={Math.max(0, y(threshold) - PAD.top)} fill="#b42b2b" opacity={0.035} />
              <line x1={PAD.left} x2={width - PAD.right} y1={y(threshold)} y2={y(threshold)} stroke="#b42b2b" strokeWidth={1.5} strokeDasharray="6 5" />
              <text x={PAD.left + 6} y={y(threshold) - 6} textAnchor="start" className="num fill-anomaly text-[11px] font-semibold">
                Threshold {formatScore(threshold)}
              </text>
            </g>
          )}

          {series.map((p, i) =>
            p.gapBefore && i > 0 ? (
              <rect key={`gap-${p.sequence}`} x={x(i - 1)} y={PAD.top} width={x(i) - x(i - 1)} height={innerH} fill="url(#gap)" />
            ) : null,
          )}
          <defs>
            <pattern id="gap" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#eceae4" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#c9c5ba" strokeWidth="2" />
            </pattern>
          </defs>

          {segments.map((d) => (
            <path key={d} d={d} fill="none" stroke="#1d5560" strokeWidth={2} strokeLinejoin="round" />
          ))}

          {series.map((p, i) => {
            if (p.alertTriggered) {
              return (
                <g key={p.sequence}>
                  <line x1={x(i)} x2={x(i)} y1={PAD.top} y2={H - PAD.bottom} stroke="#111e3b" strokeWidth={1.5} />
                  <rect x={x(i) - 5} y={PAD.top - 2} width={10} height={10} transform={`rotate(45 ${x(i)} ${PAD.top + 3})`} fill="#111e3b" />
                </g>
              );
            }
            if (p.score === null) {
              return <circle key={p.sequence} cx={x(i)} cy={H - PAD.bottom - 4} r={3} fill="none" stroke="#5f6672" strokeWidth={1.5} />;
            }
            if (p.threshold !== null && p.score > p.threshold) {
              return <circle key={p.sequence} cx={x(i)} cy={y(p.score)} r={3.5} fill="#b42b2b" stroke="#fff" strokeWidth={1.5} />;
            }
            return null;
          })}

          {f && focus !== null && (
            <g>
              <line x1={x(focus)} x2={x(focus)} y1={PAD.top} y2={H - PAD.bottom} stroke="#0f1b2d" strokeOpacity={0.35} />
              {f.score !== null && <circle cx={x(focus)} cy={y(f.score)} r={5} fill="#fff" stroke="#0f1b2d" strokeWidth={2} />}
            </g>
          )}

          {timeTicks.map((i) => (
            <text
              key={`t-${i}`}
              x={x(i)}
              y={H - 6}
              textAnchor={i === 0 && series.length > 1 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}
              className="num fill-ink-faint text-[11px]"
            >
              {formatTime(series[i].recordedAt)}
            </text>
          ))}
          <text
            transform={`translate(12 ${PAD.top + innerH / 2}) rotate(-90)`}
            textAnchor="middle"
            className="fill-ink-faint text-[11px]"
          >
            {scoreName.replace(/_/g, ' ')}
          </text>
        </svg>

        {!series.length && (
          <p className="absolute inset-0 grid place-items-center"><span className="rounded-full bg-surface px-4 py-2 text-sm text-ink-faint">
            Scored windows appear here once monitoring starts.</span>
          </p>
        )}

        {f && focus !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-2 z-10 w-56 rounded-xl border border-line bg-surface p-3 text-xs shadow-lg"
            style={x(focus) > width / 2 ? { right: width - x(focus) + 12 } : { left: x(focus) + 12 }}
          >
            <p className="num font-semibold text-ink">
              Window #{f.sequence} · {formatTime(f.recordedAt)}
            </p>
            <dl className="num mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-ink-muted">
              <dt>Score</dt>
              <dd className="text-right text-ink">{formatScore(f.score)}</dd>
              <dt>Threshold</dt>
              <dd className="text-right text-ink">{formatScore(f.threshold)}</dd>
              <dt>Signal</dt>
              <dd className="text-right text-ink">{QUALITY_LABEL[f.quality]}</dd>
              <dt>Model</dt>
              <dd className="truncate text-right text-ink">{f.modelVersion}</dd>
            </dl>
            {f.alertTriggered && <p className="mt-2 font-semibold text-navy">Sustained alert triggered here</p>}
            {f.gapBefore && <p className="mt-1 text-warning">Gap before this window (skipped or failed)</p>}
          </div>
        )}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-muted">
        <li className="flex items-center gap-2"><span aria-hidden className="h-0.5 w-5 bg-teal" />Score per window</li>
        <li className="flex items-center gap-2"><span aria-hidden className="w-5 border-t-2 border-dashed border-anomaly" />Threshold</li>
        <li className="flex items-center gap-2"><span aria-hidden className="size-2.5 rounded-full bg-anomaly" />Window above threshold</li>
        <li className="flex items-center gap-2"><span aria-hidden className="size-2.5 rotate-45 bg-navy" />Sustained alert</li>
        <li className="flex items-center gap-2"><span aria-hidden className="size-2.5 rounded-full border-[1.5px] border-unknown" />Not assessable</li>
        <li className="flex items-center gap-2"><span aria-hidden className="h-2.5 w-5 rounded-sm bg-[repeating-linear-gradient(45deg,#c9c5ba_0_2px,#eceae4_2px_5px)]" />Gap</li>
      </ul>

      <p className="sr-only">
        {latest
          ? `Latest window ${latest.sequence}: score ${formatScore(latest.score)}, threshold ${formatScore(latest.threshold)}.`
          : 'No scored windows yet.'}
      </p>
    </div>
  );
}
