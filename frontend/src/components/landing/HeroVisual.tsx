import { useEffect, useRef, useState } from 'react';

// Full-bleed hero backdrop: a deep-teal glow at the top fading into the page, with a wide glossy ribbon of sound
// sweeping across it (layout after a reference the user picked). The machine's steady hum keeps the ribbon flowing;
// every cycle one coral burst (the sound that is different) travels along it and the status chip switches to
// "Unusual burst". Status chips ride on the ribbon. Pure illustration, no model output.
// Previous heroes: git tags landing-v1-photo-hero, landing-v2-navy-logo, landing-v3-frameless-hero.

const STEADY_MS = 7000;
const BURST_MS = 3600;
const CYCLE_MS = STEADY_MS + BURST_MS;
const FIRST_BURST_OFFSET_MS = 4000; // first burst ~3 s after load, then every cycle
const CORAL = '239, 106, 82';
const TEAL = '29, 85, 96';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Ribbon centre line and half-thickness at u (0..1 across the width), as fractions of the backdrop height.
 *  A continuous travelling wave: it keeps scanning sideways like a trace on an oscilloscope. */
function ribbon(u: number, t: number, narrow: boolean) {
  const scan = u * 0.95 - t * 0.07; // phase moves right over time
  const centre = 0.5 + (narrow ? 0.07 : 0.1) * Math.sin(2 * Math.PI * scan) + 0.015 * Math.sin(2 * Math.PI * (u * 2.3 - t * 0.11));
  // the band twists as it travels: thick where it faces us, thin where it turns
  const half = (narrow ? 0.06 : 0.075) * (0.45 + 0.55 * Math.abs(Math.cos(2 * Math.PI * (u * 0.6 - t * 0.045))));
  return { centre, half };
}

/** Where a chip sits on the ribbon (percent of the backdrop) at time t: on its top edge (-1) or bottom edge (1). */
function chipSpot(u: number, narrow: boolean, t = 0, side: -1 | 1 = -1) {
  const { centre, half } = ribbon(u, t, narrow);
  return { left: `${u * 100}%`, top: `${(centre + side * half) * 100}%` };
}

function drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number, elapsed: number) {
  const now = Math.max(0, elapsed) + FIRST_BURST_OFFSET_MS;
  const t = now / 1000;
  const phase = now % CYCLE_MS;
  const burst = phase >= STEADY_MS ? (phase - STEADY_MS) / BURST_MS : -1;
  const bu = burst >= 0 ? -0.1 + 1.2 * burst : -1; // burst position along the ribbon
  const narrow = w < 640;
  ctx.clearRect(0, 0, w, h);

  // Deep teal backdrop, darkest at the top, fading into the page at the bottom ...
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, 'rgba(20, 63, 72, 1)');
  bg.addColorStop(0.45, `rgba(${TEAL}, 0.9)`);
  bg.addColorStop(0.82, 'rgba(110, 165, 170, 0.5)');
  bg.addColorStop(1, 'rgba(243, 242, 238, 0)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // ... with a soft light spot behind the centred text so it stays easy to read.
  ctx.save();
  ctx.translate(w * 0.5, h * 0.52);
  ctx.scale(narrow ? w * 0.75 : Math.min(w * 0.4, 620), h * (narrow ? 0.42 : 0.36));
  const spot = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  spot.addColorStop(0, 'rgba(243, 242, 238, 0.97)');
  spot.addColorStop(0.55, 'rgba(243, 242, 238, 0.85)');
  spot.addColorStop(1, 'rgba(243, 242, 238, 0)');
  ctx.fillStyle = spot;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const STEPS = 120;
  const edge = (side: -1 | 1, k: number, scale = 1) => {
    const u = k / STEPS;
    const { centre, half } = ribbon(u, t, narrow);
    const swell = bu >= 0 ? 1 + 0.35 * Math.exp(-(((u - bu) / 0.06) ** 2)) * smooth(0, 0.15, burst) * smooth(1, 0.85, burst) : 1;
    return [u * w, (centre + side * half * scale * swell) * h] as const;
  };

  // A faint second ribbon behind, for depth.
  ctx.save();
  ctx.translate(0, h * 0.07);
  ctx.globalAlpha = 0.28;
  ctx.beginPath();
  for (let k = 0; k <= STEPS; k++) ctx.lineTo(...edge(-1, k, 0.7));
  for (let k = STEPS; k >= 0; k--) ctx.lineTo(...edge(1, k, 0.7));
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fill();
  ctx.restore();

  // The ribbon: glossy white on top, tinted toward teal underneath.
  ctx.beginPath();
  for (let k = 0; k <= STEPS; k++) ctx.lineTo(...edge(-1, k));
  for (let k = STEPS; k >= 0; k--) ctx.lineTo(...edge(1, k));
  ctx.closePath();
  const body = ctx.createLinearGradient(0, h * 0.2, 0, h * 0.65);
  body.addColorStop(0, 'rgba(255, 255, 255, 0.97)');
  body.addColorStop(0.55, 'rgba(236, 243, 243, 0.92)');
  body.addColorStop(1, 'rgba(197, 222, 222, 0.85)');
  ctx.fillStyle = body;
  ctx.fill();

  // Coral wash where the burst is.
  if (bu >= 0) {
    const env = smooth(0, 0.15, burst) * smooth(1, 0.85, burst);
    const wash = ctx.createLinearGradient(0, 0, w, 0);
    for (let s = 0; s <= 1.0001; s += 0.05) wash.addColorStop(Math.min(1, s), `rgba(${CORAL}, ${0.55 * env * Math.exp(-(((s - bu) / 0.05) ** 2))})`);
    ctx.fillStyle = wash;
    ctx.fill();
  }

  // The scan: a soft light sweeping along the ribbon, left to right, over and over.
  {
    const sx = ((t * 0.16) % 1.4) - 0.2;
    const sweep = ctx.createLinearGradient(0, 0, w, 0);
    for (let s = 0; s <= 1.0001; s += 0.04) sweep.addColorStop(Math.min(1, s), `rgba(255, 255, 255, ${0.75 * Math.exp(-(((s - sx) / 0.08) ** 2))})`);
    ctx.beginPath();
    for (let k = 0; k <= STEPS; k++) ctx.lineTo(...edge(-1, k));
    for (let k = STEPS; k >= 0; k--) ctx.lineTo(...edge(1, k));
    ctx.closePath();
    ctx.fillStyle = sweep;
    ctx.fill();
  }

  // Fine streaks along the ribbon and a bright top edge.
  ctx.lineWidth = 1;
  for (const f of [-0.55, -0.15, 0.25, 0.6]) {
    ctx.beginPath();
    for (let k = 0; k <= STEPS; k++) {
      const u = k / STEPS;
      const { centre, half } = ribbon(u, t, narrow);
      ctx.lineTo(u * w, (centre + f * half) * h);
    }
    ctx.strokeStyle = `rgba(${TEAL}, 0.08)`;
    ctx.stroke();
  }
  ctx.beginPath();
  for (let k = 0; k <= STEPS; k++) ctx.lineTo(...edge(-1, k));
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // The burst itself: a coral glow travelling along the ribbon.
  if (bu >= 0) {
    const env = smooth(0, 0.15, burst) * smooth(1, 0.85, burst);
    const { centre } = ribbon(bu, t, narrow);
    const r = Math.min(w, h) * 0.075;
    const halo = ctx.createRadialGradient(bu * w, centre * h, 0, bu * w, centre * h, r);
    halo.addColorStop(0, `rgba(${CORAL}, ${0.38 * env})`);
    halo.addColorStop(1, `rgba(${CORAL}, 0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(bu * w - r, centre * h - r, r * 2, r * 2);
  }

  // Sparks drifting in the glow.
  for (let i = 0; i < 14; i++) {
    const x = ((i * 0.137 + t * 0.008 * (1 + (i % 3))) % 1) * w;
    const y = (0.08 + ((i * 0.29) % 0.42)) * h;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.25 + 0.3 * Math.abs(Math.sin(t * 0.8 + i))})`;
    ctx.beginPath();
    ctx.arc(x, y, i % 4 === 0 ? 2 : 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  return burst >= 0;
}

// Chip anchors along the ribbon (u), wide and narrow layouts: listening, alert rule, status.
// listening (top edge, left), alert rule (bottom edge, right), status (top edge, right)
const CHIP_U = { wide: [0.1, 0.9, 0.9], narrow: [0.1, 0.9, 0.9] };
const CHIP_SIDE: (-1 | 1)[] = [-1, 1, -1];

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function HeroVisual() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [burst, setBurst] = useState(false);
  const [narrow, setNarrow] = useState(() => typeof innerWidth === 'number' && innerWidth < 640);
  const chipRefs = useRef<(HTMLDivElement | null)[]>([]);

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
      const elapsed = still ? STEADY_MS + BURST_MS * 0.42 - FIRST_BURST_OFFSET_MS : now - start;
      const b = drawFrame(ctx, w, h, elapsed);
      if (b !== last) setBurst((last = b));
      // keep the chips riding on the ribbon as it flows
      const t = (Math.max(0, elapsed) + FIRST_BURST_OFFSET_MS) / 1000;
      const us = w < 640 ? CHIP_U.narrow : CHIP_U.wide;
      chipRefs.current.forEach((el, i) => {
        if (!el) return;
        const spot = chipSpot(us[i], w < 640, t, CHIP_SIDE[i]);
        el.style.left = spot.left;
        el.style.top = spot.top;
      });
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
      setNarrow(w < 640);
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

  const U = narrow ? CHIP_U.narrow : CHIP_U.wide;
  const chip = 'float absolute -translate-x-1/2 rounded-full bg-surface/90 shadow-lg ring-1 ring-black/5 backdrop-blur-md';

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="size-full" />
      <div className="absolute inset-0 opacity-[0.16] mix-blend-multiply" style={{ backgroundImage: NOISE }} />

      {/* Chips riding on the ribbon */}
      <div ref={(el) => void (chipRefs.current[0] = el)} className={`${chip} -translate-y-[85%] hidden items-center gap-3 py-2 pr-4 pl-2 lg:flex`} style={{ ...chipSpot(U[0], narrow, 0, -1), '--d': '0ms' } as React.CSSProperties}>
        <span className="grid size-8 place-items-center rounded-full bg-teal">
          <span className="eq flex h-3.5 items-end gap-[2px]">
            {[0, 180, 90, 270].map((d) => (
              <span key={d} className="w-[3px] rounded-full bg-white" style={{ height: '100%', '--d': `${d}ms` } as React.CSSProperties} />
            ))}
          </span>
        </span>
        <span className="text-xs font-semibold whitespace-nowrap text-ink">Listening · fan_01</span>
      </div>

      <div ref={(el) => void (chipRefs.current[1] = el)} className={`${chip} translate-y-[20%] hidden !rounded-2xl px-4 py-3 lg:block`} style={{ ...chipSpot(U[1], narrow, 0, 1), '--d': '1200ms' } as React.CSSProperties}>
        <p className="text-[10px] text-ink-faint">Alert rule</p>
        <p className="num mt-0.5 text-sm font-semibold whitespace-nowrap text-ink">3 of last 5 windows</p>
        <div className="mt-2 flex gap-1">
          {[1, 0, 1, 1, 0].map((on, i) => (
            <span key={i} className={`h-1.5 w-5 rounded-full ${on ? 'bg-[#ef6a52]' : 'bg-line'}`} />
          ))}
        </div>
      </div>

      <div ref={(el) => void (chipRefs.current[2] = el)} className="float absolute hidden -translate-x-1/2 -translate-y-[85%] lg:block" style={{ ...chipSpot(U[2], narrow, 0, -1), '--d': '600ms' } as React.CSSProperties}>
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap shadow-lg ring-1 backdrop-blur-md transition-colors duration-500 ${
            burst ? 'bg-anomaly-soft/95 text-anomaly ring-anomaly/20' : 'bg-surface/90 text-ink ring-black/5'
          }`}
        >
          <span className={`size-1.5 rounded-full ${burst ? 'bg-anomaly' : 'bg-normal'}`} />
          {burst ? 'Unusual burst' : 'Steady hum'}
        </span>
      </div>
    </div>
  );
}
