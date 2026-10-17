import { useEffect, useRef, useState } from 'react';
import heroImg from '../../assets/landing/hero-technician.webp';
import { RollingBuffer } from '../../audio/rollingBuffer';
import { startSimulated, type SimulatedProfile } from '../../audio/sources';
import { SpectrogramChart } from '../charts/SpectrogramChart';
import { WaveformChart } from '../charts/WaveformChart';

const CYCLE: { profile: SimulatedProfile; ms: number }[] = [
  { profile: 'normal', ms: 8000 },
  { profile: 'anomaly', ms: 6000 },
];

/**
 * Photo with floating cards rendering the real browser pipeline on deterministic simulated audio.
 * It is an illustration: no model output is shown.
 */
export function HeroVisual() {
  const bufferRef = useRef<RollingBuffer | null>(null);
  const [profile, setProfile] = useState<SimulatedProfile>('normal');
  const profileRef = useRef(profile);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    bufferRef.current = new RollingBuffer(16000 * 15);
    const src = startSimulated((c) => bufferRef.current?.push(c), () => profileRef.current, 16000, 10_000);
    setRunning(true);
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      t = setTimeout(() => {
        i = (i + 1) % CYCLE.length;
        profileRef.current = CYCLE[i].profile;
        setProfile(CYCLE[i].profile);
        next();
      }, CYCLE[i].ms);
    };
    next();
    return () => {
      clearTimeout(t);
      src.stop();
    };
  }, []);

  const unusual = profile === 'anomaly';
  const rate = running ? 16000 : null;

  return (
    <div className="fade-up relative h-full min-h-[420px]" style={{ '--d': '250ms' } as React.CSSProperties}>
      <div className="absolute inset-0 overflow-hidden rounded-[32px] bg-navy">
        <img
          src={heroImg}
          alt="A maintenance technician beside a large industrial ventilation fan"
          className="kenburns size-full object-cover object-[50%_30%]"
          fetchPriority="high"
        />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-navy/75 via-navy/10 to-transparent" />
      </div>

      {/* Listening indicator */}
      <div className="float absolute top-5 left-5 flex items-center gap-3 rounded-full bg-white/85 py-2 pr-4 pl-2 shadow-lg ring-1 ring-black/5 backdrop-blur-md" style={{ '--d': '0ms' } as React.CSSProperties}>
        <span className="grid size-8 place-items-center rounded-full bg-navy">
          <span aria-hidden className="eq flex h-3.5 items-end gap-[2px]">
            {[0, 180, 90, 270].map((d) => (
              <span key={d} className="w-[3px] rounded-full bg-on-dark" style={{ height: '100%', '--d': `${d}ms` } as React.CSSProperties} />
            ))}
          </span>
        </span>
        <span className="text-xs font-semibold text-ink">Listening · fan_01</span>
      </div>

      {/* Live spectrogram card */}
      <div
        className="float absolute right-4 bottom-4 left-4 rounded-[22px] bg-white/88 p-4 shadow-2xl ring-1 ring-black/5 backdrop-blur-md sm:right-5 sm:bottom-5 sm:left-auto sm:w-[78%]"
        style={{ '--d': '600ms' } as React.CSSProperties}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="eyebrow text-ink-faint">Live spectrogram</p>
          <span
            aria-live="polite"
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors duration-500 ${
              unusual ? 'bg-warning-soft text-warning' : 'bg-teal-soft text-teal'
            }`}
          >
            <span aria-hidden className={`size-1.5 rounded-full ${unusual ? 'bg-warning' : 'bg-teal'}`} />
            {unusual ? 'Simulated: whine + knocks' : 'Simulated: steady fan'}
          </span>
        </div>
        <SpectrogramChart bufferRef={bufferRef} sampleRate={rate} running={running} compact="h-24 rounded-xl sm:h-28" />
        <div className="mt-3">
          <WaveformChart bufferRef={bufferRef} sampleRate={rate} running={running} compact="h-9" />
        </div>
        <p className="mt-2 text-[10px] leading-snug text-ink-faint">
          Illustration · synthetic audio drawn live by the console's chart code. No model output.
        </p>
      </div>

      {/* Alert rule chip */}
      <div
        className="float absolute top-5 right-5 hidden rounded-2xl bg-navy/90 px-4 py-3 text-on-dark shadow-xl backdrop-blur-md md:block"
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
    </div>
  );
}
