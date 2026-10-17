import { useEffect, useRef, useState } from 'react';

// Motion graphic: a field of flowing sound lines (the machine's steady hum) with soft ripples from the source.
// Every cycle one coral burst travels across the field and sends out its own ripples: the sound that is different,
// the same idea as the logo. Pure illustration, no model output. Previous photo hero: git tag landing-v1-photo-hero.

const LINES = 18;
const STEADY_MS = 7000;
const BURST_MS = 3600;
const CYCLE_MS = STEADY_MS + BURST_MS;
const FIRST_BURST_OFFSET_MS = 4000; // first burst ~3 s after load, then every cycle
const LIGHT = [238, 242, 247];
const CORAL = [239, 106, 82];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number, elapsed: number) {
  const now = Math.max(0, elapsed) + FIRST_BURST_OFFSET_MS;
  const t = now / 1000;
  const phase = now % CYCLE_MS;
  const burst = phase >= STEADY_MS ? (phase - STEADY_MS) / BURST_MS : -1; // 0..1 while the burst crosses
  const bx = burst >= 0 ? -0.12 + 1.24 * burst : -1; // burst centre, fraction of width
  const sx = w * 0.5;
  const sy = h * 0.53;
  const rMax = Math.hypot(w, h) * 0.62;

  ctx.clearRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, rMax);
  glow.addColorStop(0, 'rgba(29, 85, 96, 0.55)');
  glow.addColorStop(1, 'rgba(17, 30, 59, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Ripples: steady pulses from the source, coral ones from the burst.
  ctx.lineWidth = 1.5;
  for (let k = 0; k < 3; k++) {
    const age = ((t / 2.6 + k / 3) % 1);
    ctx.strokeStyle = `rgba(166, 177, 196, ${0.2 * (1 - age) ** 2})`;
    ctx.beginPath();
    ctx.arc(sx, sy, age * rMax, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (burst >= 0) {
    for (const start of [0.12, 0.3, 0.48]) {
      if (burst < start) continue;
      const age = Math.min(1, (burst - start) / 0.55);
      ctx.strokeStyle = `rgba(${CORAL.join(',')}, ${0.45 * (1 - age) ** 2})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc((-0.12 + 1.24 * start) * w, sy, age * rMax * 0.7, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Wave field.
  const top = h * 0.24;
  const bottom = h * 0.84;
  for (let i = 0; i < LINES; i++) {
    const f = i / (LINES - 1);
    const y0 = top + f * (bottom - top);
    const mid = 1 - Math.abs(f - 0.5) * 2; // 1 in the middle of the field, 0 at its edges
    const amp = 3 + 11 * mid;
    const alpha = 0.14 + 0.5 * mid;

    const grad = ctx.createLinearGradient(0, 0, w, 0);
    for (let u = 0; u <= 1.0001; u += 0.04) {
      const hot = burst >= 0 ? Math.exp(-(((u - bx) / 0.07) ** 2)) : 0;
      const c = LIGHT.map((v, j) => Math.round(v + (CORAL[j] - v) * hot));
      const a = Math.min(1, alpha * (1 + hot * 1.4)) * smooth(0, 0.16, u) * smooth(1, 0.84, u);
      grad.addColorStop(Math.min(1, u), `rgba(${c.join(',')}, ${a})`);
    }

    ctx.beginPath();
    for (let x = 0; x <= w + 3; x += 3) {
      const u = x / w;
      let y = y0 + amp * (0.62 * Math.sin(u * 8.5 + t * 1.05 + i * 0.42) + 0.38 * Math.sin(u * 17 - t * 1.6 + i * 0.77));
      if (burst >= 0) {
        const d = (u - bx) / 0.065;
        y += Math.exp(-d * d) * (0.3 + mid) * 24 * Math.sin(u * 75 - t * 15 + i * 0.35);
      }
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.2 + 0.8 * mid;
    ctx.stroke();
  }
  return burst >= 0;
}

export function HeroVisual() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [burst, setBurst] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    let raf = 0;
    let onScreen = true;
    let last = false;
    const start = performance.now();

    const render = (now: number) => {
      const b = drawFrame(ctx, w, h, still ? STEADY_MS + BURST_MS * 0.42 - FIRST_BURST_OFFSET_MS : now - start);
      if (b !== last) setBurst((last = b));
    };
    const loop = (now: number) => {
      render(now);
      raf = onScreen ? requestAnimationFrame(loop) : 0;
    };
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render(performance.now());
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    // Only animate while visible (saves battery further down the page).
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      if (onScreen && !raf && !still) raf = requestAnimationFrame(loop);
    });
    io.observe(canvas);
    if (!still) raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return (
    <div className="fade-up relative h-full min-h-[420px]" style={{ '--d': '250ms' } as React.CSSProperties}>
      <div className="absolute inset-0 overflow-hidden rounded-[32px] bg-navy">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Animated illustration: flowing sound waves from a machine; now and then one unusual burst ripples through"
          className="size-full"
        />
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[32px] ring-1 ring-white/5 ring-inset" />
      </div>

      {/* Listening indicator */}
      <div className="float absolute top-5 left-5 flex items-center gap-3 rounded-full bg-white/90 py-2 pr-4 pl-2 shadow-lg ring-1 ring-black/5 backdrop-blur-md" style={{ '--d': '0ms' } as React.CSSProperties}>
        <span className="grid size-8 place-items-center rounded-full bg-navy">
          <span aria-hidden className="eq flex h-3.5 items-end gap-[2px]">
            {[0, 180, 90, 270].map((d) => (
              <span key={d} className="w-[3px] rounded-full bg-on-dark" style={{ height: '100%', '--d': `${d}ms` } as React.CSSProperties} />
            ))}
          </span>
        </span>
        <span className="text-xs font-semibold text-ink">Listening · fan_01</span>
      </div>

      {/* Alert rule chip */}
      <div
        className="float absolute top-5 right-5 hidden rounded-2xl bg-white/[0.07] px-4 py-3 text-on-dark ring-1 ring-white/10 backdrop-blur-md md:block"
        style={{ '--d': '1200ms' } as React.CSSProperties}
      >
        <p className="text-[10px] text-on-dark-muted">Alert rule</p>
        <p className="num mt-0.5 text-sm font-semibold">3 of last 5 windows</p>
        <div aria-hidden className="mt-2 flex gap-1">
          {[1, 0, 1, 1, 0].map((on, i) => (
            <span key={i} className={`h-1.5 w-5 rounded-full ${on ? 'bg-anomaly-on-dark' : 'bg-on-dark/25'}`} />
          ))}
        </div>
      </div>

      {/* What the illustration is showing right now */}
      <div className="float absolute bottom-5 left-5 grid gap-1" style={{ '--d': '600ms' } as React.CSSProperties}>
        <span
          aria-live="polite"
          className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 backdrop-blur-md transition-colors duration-500 ${
            burst ? 'bg-anomaly-on-dark/15 text-anomaly-on-dark ring-anomaly-on-dark/30' : 'bg-white/[0.07] text-on-dark ring-white/10'
          }`}
        >
          <span aria-hidden className={`size-1.5 rounded-full ${burst ? 'bg-anomaly-on-dark' : 'bg-normal-on-dark'}`} />
          {burst ? 'Unusual burst' : 'Steady hum'}
        </span>
        <span className="text-[10px] text-on-dark-muted/80">Illustration · not model output</span>
      </div>
    </div>
  );
}
