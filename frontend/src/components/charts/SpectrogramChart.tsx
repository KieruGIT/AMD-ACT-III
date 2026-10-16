import { useRef, type RefObject } from 'react';
import type { RollingBuffer } from '../../audio/rollingBuffer';
import { spectrumDb } from '../../audio/fft';
import { formatHz } from '../../lib/format';
import { useCanvasLoop } from './useCanvasLoop';
import { TimeAxis } from './TimeAxis';
import { VIEW_SECONDS } from './WaveformChart';

const FFT_SIZE = 1024;
const ROWS = 128;
const DB_MIN = -70;
const DB_MAX = -15;
const MAX_HZ = 8000; // matches the 16 kHz model input's Nyquist limit

// Off-white → teal → navy: low energy fades into the card, high energy reads dark.
const STOPS: [number, number, number][] = [
  [247, 246, 242],
  [203, 224, 221],
  [95, 154, 155],
  [29, 85, 96],
  [17, 30, 59],
];
const PALETTE = Array.from({ length: 256 }, (_, i) => {
  const t = (i / 255) * (STOPS.length - 1);
  const a = STOPS[Math.floor(t)];
  const b = STOPS[Math.min(STOPS.length - 1, Math.floor(t) + 1)];
  const f = t - Math.floor(t);
  return a.map((c, k) => Math.round(c + (b[k] - c) * f)) as [number, number, number];
});

/** Scrolling STFT spectrogram computed in the browser from the captured audio. */
export function SpectrogramChart({
  bufferRef,
  sampleRate,
  running,
}: {
  bufferRef: RefObject<RollingBuffer | null>;
  sampleRate: number | null;
  running: boolean;
}) {
  const img = useRef<HTMLCanvasElement | null>(null);
  const nextPos = useRef(0);
  const frame = useRef(new Float32Array(FFT_SIZE));
  const spec = useRef(new Float32Array(FFT_SIZE / 2));
  const topHz = Math.min(MAX_HZ, (sampleRate ?? 16000) / 2);

  const canvasRef = useCanvasLoop((ctx, w, h) => {
    let off = img.current;
    if (!off || off.width !== w) {
      off = document.createElement('canvas');
      off.width = w;
      off.height = ROWS;
      const octx = off.getContext('2d')!;
      octx.fillStyle = `rgb(${PALETTE[0].join(',')})`;
      octx.fillRect(0, 0, w, ROWS);
      img.current = off;
      nextPos.current = bufferRef.current?.total ?? 0;
    }
    const octx = off.getContext('2d')!;
    const buf = bufferRef.current;

    if (buf && sampleRate) {
      if (buf.total < nextPos.current) nextPos.current = buf.total; // buffer was cleared
      const hop = (sampleRate * VIEW_SECONDS) / w;
      const pending = Math.min(w, Math.floor((buf.total - nextPos.current) / hop));
      if (pending > 0) {
        octx.drawImage(off, -pending, 0);
        const col = octx.createImageData(1, ROWS);
        const binHz = sampleRate / FFT_SIZE;
        for (let c = 0; c < pending; c++) {
          nextPos.current += hop;
          spectrumDb(buf.readEndingAt(Math.round(nextPos.current), FFT_SIZE, frame.current), spec.current);
          for (let r = 0; r < ROWS; r++) {
            const lo = Math.floor(((r / ROWS) * topHz) / binHz);
            const hi = Math.max(lo + 1, Math.floor((((r + 1) / ROWS) * topHz) / binHz));
            let db = -Infinity;
            for (let k = lo; k < hi; k++) db = Math.max(db, spec.current[k]);
            const v = Math.round(Math.max(0, Math.min(1, (db - DB_MIN) / (DB_MAX - DB_MIN))) * 255);
            const [cr, cg, cb] = PALETTE[v];
            const p = (ROWS - 1 - r) * 4;
            col.data[p] = cr;
            col.data[p + 1] = cg;
            col.data[p + 2] = cb;
            col.data[p + 3] = 255;
          }
          octx.putImageData(col, w - pending + c, 0);
        }
      }
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, w, h);
  }, running);

  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => Math.round(topHz * f));

  return (
    <figure className="m-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-ink-faint">
        <figcaption className="font-medium text-ink-muted">Spectrogram · STFT, linear frequency</figcaption>
        <span>Browser-computed view, not the model's log-mel input</span>
      </div>
      <div className="flex gap-2">
        <div aria-hidden className="num flex w-12 shrink-0 flex-col justify-between text-right text-[11px] text-ink-faint">
          {ticks.map((t) => (
            <span key={t}>{formatHz(t)}</span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <canvas
            ref={canvasRef}
            className="block h-40 w-full rounded-[10px] sm:h-48"
            role="img"
            aria-label={`Spectrogram, 0 to ${formatHz(topHz)}, last ${VIEW_SECONDS} seconds; darker means more energy`}
          />
          <TimeAxis seconds={VIEW_SECONDS} />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-2 text-[11px] text-ink-faint">
        <span>Low energy</span>
        <span
          aria-hidden
          className="h-2 w-24 rounded-full"
          style={{ background: `linear-gradient(90deg, ${STOPS.map((s) => `rgb(${s.join(',')})`).join(',')})` }}
        />
        <span>High</span>
      </div>
    </figure>
  );
}
