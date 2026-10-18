import { useRef, useState, type RefObject } from 'react';
import type { RollingBuffer } from '../../audio/rollingBuffer';
import { rmsDb } from '../../audio/fft';
import { useCanvasLoop } from './useCanvasLoop';
import { TimeAxis } from './TimeAxis';

export const VIEW_SECONDS = 10;

/** Peak-envelope waveform of the last VIEW_SECONDS. Shows input signal, not the AI decision. */
const SILENT_DBFS = -70; // below this the input is effectively silent (muted mic, blocked permission)

export function WaveformChart({
  bufferRef,
  sampleRate,
  running,
  compact,
}: {
  bufferRef: RefObject<RollingBuffer | null>;
  sampleRate: number | null;
  running: boolean;
  /** Canvas only, sized by `compact` (a height class). Used for decorative previews. */
  compact?: string;
}) {
  const scratch = useRef(new Float32Array(0));
  const range = useRef(0.05);
  const [readout, setReadout] = useState<{ range: number; level: number | null }>({ range: 0.05, level: null });
  const lastReadout = useRef(0);

  const canvasRef = useCanvasLoop((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2;
    ctx.strokeStyle = '#e0ddd5';
    ctx.lineWidth = 1;
    for (const y of [mid, mid - h * 0.4, mid + h * 0.4]) {
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
      ctx.stroke();
    }

    const buf = bufferRef.current;
    if (!buf || !sampleRate || buf.size === 0) return;
    const n = Math.round(sampleRate * VIEW_SECONDS);
    if (scratch.current.length !== n) scratch.current = new Float32Array(n);
    const data = buf.readEndingAt(buf.total, n, scratch.current);

    // Auto-range with slow decay; the axis label reports the true full-scale range shown.
    let peak = 0;
    for (let i = n - Math.min(n, sampleRate); i < n; i++) peak = Math.max(peak, Math.abs(data[i]));
    range.current = Math.max(0.02, Math.min(1, Math.max(peak * 1.15, range.current * 0.995)));
    const scale = (h * 0.4) / range.current;

    const per = n / w;
    ctx.fillStyle = '#1d5560';
    for (let x = 0; x < w; x++) {
      let lo = 0;
      let hi = 0;
      const end = Math.min(n, Math.floor((x + 1) * per));
      for (let i = Math.floor(x * per); i < end; i++) {
        const v = data[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const top = mid - hi * scale;
      ctx.fillRect(x, top, 1, Math.max(1, (hi - lo) * scale));
    }

    const now = performance.now();
    if (now - lastReadout.current > 500) {
      lastReadout.current = now;
      setReadout({ range: range.current, level: rmsDb(data.subarray(n - Math.min(n, sampleRate))) });
    }
  }, running);

  if (compact) return <canvas ref={canvasRef} className={`block w-full ${compact}`} role="img" aria-label="Live audio waveform" />;

  return (
    <figure className="m-0">
      <div className="mb-2 flex items-baseline justify-between gap-3 text-xs text-ink-faint">
        <figcaption className="font-medium text-ink-muted">Amplitude · last {VIEW_SECONDS} s</figcaption>
        <span className="num">
          {readout.level !== null && sampleRate ? `Level ${readout.level.toFixed(0)} dBFS · ` : ''}scale ±
          {readout.range.toFixed(2)} FS
        </span>
      </div>
      <div className="relative">
        <canvas ref={canvasRef} className="block h-28 w-full sm:h-32" role="img" aria-label="Live audio waveform" />
        {running && readout.level !== null && readout.level < SILENT_DBFS && (
          <div role="status" className="absolute inset-0 grid place-items-center rounded-xl bg-surface/85 p-3 text-center backdrop-blur-[1px]">
            <div className="max-w-md text-sm">
              <p className="font-semibold text-warning">No sound is reaching the microphone</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                Check that it isn't muted and that this site may use it. If the browser just asked you to reload the page, reload it
                and start again. Or pick another input under Microphone &amp; sound in your account menu.
              </p>
            </div>
          </div>
        )}
      </div>
      <TimeAxis seconds={VIEW_SECONDS} />
    </figure>
  );
}
