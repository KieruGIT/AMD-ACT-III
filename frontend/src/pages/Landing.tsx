import {
  ArrowRight,
  AudioLines,
  BellRing,
  Check,
  CircleHelp,
  Code2,
  Cpu,
  Gauge,
  Lock,
  Minus,
  Plus,
  TimerReset,
  Unplug,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import sensorImg from '../assets/landing/sensor-motor.webp';
import { Logo, LogoMark } from '../components/brand/Logo';
import { HeroVisual } from '../components/landing/HeroVisual';
import { useReveal } from '../hooks/useReveal';
import { credentials } from '../lib/credentials';

const REPO = 'https://github.com/KieruGIT/AMD-ACT-III';
const HEADLINE = 'Hear when a machine stops sounding like itself.';

const STEPS = [
  { Icon: AudioLines, title: 'Listen', body: 'The browser captures microphone audio into a rolling buffer while monitoring is on.' },
  { Icon: TimerReset, title: 'Window', body: 'Every second, the latest 3-second window is sent to the analysis service as WAV.' },
  { Icon: Gauge, title: 'Score', body: 'An autoencoder trained only on normal sound scores how poorly it can reconstruct the window.' },
  { Icon: BellRing, title: 'Alert', body: 'Only when unusual windows persist does the backend open one alert for a person to review.' },
];

const PRINCIPLES: { Icon: typeof Check; title: string; body: string; wide?: boolean }[] = [
  {
    Icon: BellRing,
    title: 'Sustained, not spikes',
    body: 'An alert needs 3 of the last 5 valid windows above the calibrated threshold. A door slam is one window; it never pages anyone.',
    wide: true,
  },
  { Icon: Unplug, title: 'Never a stale green', body: 'Lost connection, hidden tab or revoked mic switches to Interrupted, not a frozen "Normal".' },
  { Icon: CircleHelp, title: 'Says when it can’t tell', body: 'Silence, clipping or noisy input reads Unable to assess instead of guessing.' },
  { Icon: Gauge, title: 'A score, not a percentage', body: 'Reconstruction error is shown as itself, with its threshold. It is not a failure probability.' },
  { Icon: Lock, title: 'No recordings by default', body: 'Audio lives in memory only long enough to build windows. History keeps timestamps and scores, not sound.' },
];

const TICKER = [
  'Normal-only training',
  '3 of 5 windows to alert',
  'Never a stale green',
  'Score ≠ probability',
  'No recordings by default',
  'PyTorch + ROCm on AMD',
  'Human review, never auto-stop',
];

const FAQ: [string, ReactNode][] = [
  [
    'Is this an industrial safety system?',
    'No. It is an experimental acoustic anomaly detector. Alerts are a prompt for a technician to inspect the machine; the system never stops equipment and does not replace human judgment.',
  ],
  [
    'Does it predict when a machine will fail?',
    'No. It flags sound that differs from what the model learned as normal. That can be an early sign of a fault, but it can also be a moved microphone or a noisy room. It does not diagnose faults or forecast failure dates.',
  ],
  [
    'Which machines does it support?',
    'One machine family per trained profile. The prototype targets a single fan profile from public research data (DCASE 2020 Task 2 / MIMII). We do not claim one model fits every machine.',
  ],
  [
    'Will it work on the fan in my room?',
    'It will capture and visualise it, but a home fan sounds different from industrial training data, so a high score there does not validate anything. Accuracy is demonstrated on held-out dataset clips.',
  ],
  [
    'What runs on AMD?',
    'Model training and inference are planned on an AMD GPU with PyTorch + ROCm. Only work that actually ran on AMD hardware will be claimed, with runtime evidence and measured latency.',
  ],
  [
    'What happens to my audio?',
    'It is processed in memory to build analysis windows and discarded when monitoring stops. Raw audio is not stored unless evidence retention is explicitly enabled, which this prototype does not offer yet.',
  ],
];

const delay = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <p className={`eyebrow ${dark ? 'text-on-dark-muted' : 'text-ink-faint'}`}>{children}</p>;
}

function CTA({ href, children, variant = 'primary' }: { href: string; children: ReactNode; variant?: 'primary' | 'secondary' | 'light' }) {
  const cls = {
    primary: 'bg-teal text-white hover:bg-teal-strong',
    secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-muted',
    light: 'bg-on-dark text-navy hover:bg-white',
  }[variant];
  return (
    <a href={href} className={`arrow-nudge inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold transition-colors ${cls}`}>
      {children}
    </a>
  );
}

function SectionTitle({ eyebrow, children, dark }: { eyebrow: string; children: ReactNode; dark?: boolean }) {
  return (
    <div data-reveal>
      <Eyebrow dark={dark}>{eyebrow}</Eyebrow>
      <h2 className="mt-3 max-w-2xl text-[clamp(2rem,3.6vw,3rem)] leading-[1.02] font-semibold tracking-[-0.035em] text-balance">
        {children}
      </h2>
    </div>
  );
}

export function Landing() {
  useReveal();

  return (
    <div className="min-h-dvh overflow-x-clip">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-6 px-4 sm:px-6 lg:px-8">
          <a href="/" aria-label="Machine Sound Monitor home">
            <Logo hideNameOnTiny />
          </a>
          <nav aria-label="Sections" className="ml-auto hidden items-center gap-1 lg:flex">
            {[
              ['#how', 'How it works'],
              ['#principles', 'Principles'],
              ['#amd', 'AMD'],
              ['#faq', 'FAQ'],
            ].map(([href, label]) => (
              <a key={href} href={href} className="rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink">
                {label}
              </a>
            ))}
          </nav>
          {/* Returning visitors (signed in, guest or paired device) go straight back to their console. */}
          <a
            href={credentials ? '/app' : '/signin'}
            className="arrow-nudge ml-auto inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full bg-ink px-4 text-sm font-semibold whitespace-nowrap text-white transition-colors hover:bg-navy-raised lg:ml-0"
          >
            {credentials ? 'Open console' : 'Sign in'}
            <ArrowRight aria-hidden className="size-4" />
          </a>
        </div>
      </header>

      <main>
        {/* Hero: sized to the first screen on desktop */}
        <section
          data-testid="hero"
          className="mx-auto grid max-w-[1280px] gap-10 px-4 pt-10 pb-14 sm:px-6 sm:pt-14 lg:h-[calc(100svh-4rem)] lg:max-h-[860px] lg:min-h-[560px] lg:grid-cols-[1.02fr_1fr] lg:gap-14 lg:px-8 lg:py-10"
        >
          <div className="flex flex-col justify-center">
            <h1
              aria-label={HEADLINE}
              className="text-[clamp(2.6rem,min(5.4vw,9.6svh),5.25rem)] leading-[0.93] font-semibold tracking-[-0.045em]"
            >
              {HEADLINE.split(' ').map((w, i) => (
                <span key={i} aria-hidden className="word mr-[0.22em]" style={{ '--i': i } as CSSProperties}>
                  {w}
                </span>
              ))}
            </h1>
            <p className="fade-up mt-6 max-w-xl text-[clamp(1rem,1.25vw,1.125rem)] leading-relaxed text-ink-muted" style={delay(650)}>
              A web console that listens to a supported machine, scores every audio window against its learned normal sound,
              and alerts an operator, with the evidence of when, only when unusual sound persists.
            </p>
            <div className="fade-up mt-9 flex flex-wrap gap-3" style={delay(800)}>
              <CTA href="/signin">
                Get started
                <ArrowRight aria-hidden className="size-4" />
              </CTA>
              <CTA href="#how" variant="secondary">How it works</CTA>
            </div>
          </div>
          <div className="h-[480px] sm:h-[560px] lg:h-auto">
            <HeroVisual />
          </div>
        </section>

        {/* Ticker */}
        <div aria-hidden className="overflow-hidden border-y border-line bg-navy py-4 text-on-dark">
          <div className="marquee flex w-max gap-10 whitespace-nowrap">
            {[...TICKER, ...TICKER].map((t, i) => (
              <span key={i} className="flex items-center gap-10 text-sm font-medium tracking-tight">
                {t}
                <span className="size-1.5 rounded-full bg-teal-soft/60" />
              </span>
            ))}
          </div>
        </div>

        {/* Approach + sensor photo */}
        <section className="mx-auto grid max-w-[1280px] items-center gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:px-8 lg:py-28">
          <div data-reveal>
            <Eyebrow>Our approach</Eyebrow>
            <p className="mt-5 text-[clamp(1.5rem,2.5vw,2.2rem)] leading-[1.22] font-medium tracking-[-0.02em] text-ink">
              Healthy machines have a consistent sound. We train a model on that sound alone,{' '}
              <span className="text-ink-faint">
                score each new window by how far it drifts, and ask a person to look only when the drift persists, instead of
                waiting for someone to notice and file a report.
              </span>
            </p>
            <a href="#how" className="arrow-nudge mt-8 inline-flex items-center gap-2 text-sm font-semibold tracking-wide text-ink uppercase">
              See the pipeline
              <ArrowRight aria-hidden className="size-4" />
            </a>
          </div>
          <figure data-reveal style={delay(150)} className="relative m-0 aspect-[4/3] overflow-hidden rounded-[28px] bg-navy">
            <img src={sensorImg} alt="A compact microphone clipped to the housing of an industrial fan motor" loading="lazy" className="parallax size-full object-cover" />
            <figcaption className="absolute bottom-4 left-4 rounded-full bg-white/85 px-3 py-1.5 text-xs font-medium text-ink backdrop-blur-md">
              One microphone · one machine profile
            </figcaption>
          </figure>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-20 border-t border-line bg-surface">
          <div className="mx-auto max-w-[1280px] px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <SectionTitle eyebrow="How it works">Four separate signals, never one blinking light.</SectionTitle>
              <p data-reveal style={delay(120)} className="max-w-sm text-sm text-ink-muted">
                The console keeps each stage visible, so “the mic is on” is never confused with “the machine sounds normal”.
              </p>
            </div>
            <div data-reveal className="relative mt-14">
              <div aria-hidden className="absolute top-6 right-[12.5%] left-[12.5%] hidden lg:block">
                <div className="draw-line h-0.5 w-full rounded-full bg-line-strong" />
                <span className="travel absolute top-1/2 -mt-1.5 -ml-1.5 size-3 rounded-full bg-teal shadow-[0_0_0_6px_rgb(29_85_96/0.15)]" />
              </div>
              <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {STEPS.map(({ Icon, title, body }, i) => (
                  <li key={title} data-reveal style={delay(150 + i * 140)} className="relative flex flex-col items-center text-center">
                    <span className="relative grid size-12 place-items-center rounded-full bg-navy text-on-dark ring-8 ring-surface">
                      <Icon aria-hidden className="size-5" />
                    </span>
                    <div className="mt-5 w-full flex-1 rounded-[var(--radius-card)] border border-line bg-canvas p-6 transition-transform duration-300 hover:-translate-y-1">
                      <p className="num text-xs font-semibold text-ink-faint">0{i + 1}</p>
                      <h3 className="mt-1 text-xl font-semibold tracking-tight">{title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Principles bento */}
        <section id="principles" className="scroll-mt-20">
          <div className="mx-auto max-w-[1280px] px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
            <SectionTitle eyebrow="Built for trust">Alerts an operator can believe.</SectionTitle>
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {PRINCIPLES.map(({ Icon, title, body, wide }, i) => (
                <article
                  key={title}
                  data-reveal
                  style={delay(i * 90)}
                  className={`group relative overflow-hidden rounded-[var(--radius-card)] p-6 transition-transform duration-300 hover:-translate-y-1 sm:p-7 ${
                    wide ? 'bg-teal text-white md:col-span-2' : 'border border-line bg-surface'
                  }`}
                >
                  {wide && (
                    <div aria-hidden className="eq absolute right-6 bottom-0 flex h-28 items-end gap-2 opacity-20">
                      {[0, 260, 520, 130, 390, 650, 70].map((d) => (
                        <span key={d} className="w-4 rounded-t-md bg-white" style={{ height: '100%', '--d': `${d}ms` } as CSSProperties} />
                      ))}
                    </div>
                  )}
                  <Icon aria-hidden className={`size-6 transition-transform duration-300 group-hover:scale-110 ${wide ? 'text-teal-soft' : 'text-teal'}`} />
                  <h3 className="mt-8 text-xl font-semibold tracking-tight">{title}</h3>
                  <p className={`relative mt-2 max-w-lg text-sm leading-relaxed ${wide ? 'text-teal-soft' : 'text-ink-muted'}`}>{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* AMD */}
        <section id="amd" className="scroll-mt-20 px-4 pb-20 sm:px-6 lg:px-8 lg:pb-28">
          <div data-reveal className="on-dark relative mx-auto grid max-w-[1280px] gap-10 overflow-hidden rounded-[32px] bg-navy p-8 text-on-dark sm:p-12 lg:grid-cols-2 lg:p-16">
            <div aria-hidden className="pointer-events-none absolute top-1/2 left-[22%]">
              {[0, 1500, 3000, 4500].map((d) => (
                <span key={d} className="ripple absolute size-[520px] rounded-full border border-teal-soft/25" style={delay(d)} />
              ))}
            </div>
            <div className="relative">
              <Eyebrow dark>AMD contribution</Eyebrow>
              <h2 className="mt-3 text-[clamp(2rem,3.6vw,3rem)] leading-[1.02] font-semibold tracking-[-0.035em]">
                Built to train and evaluate on AMD GPUs.
              </h2>
              <p className="mt-5 max-w-md leading-relaxed text-on-dark-muted">
                The anomaly model is trained with PyTorch on ROCm, compared against a DCASE-style dense autoencoder baseline on
                the same held-out split, and served for inference. Numbers appear here only after they are measured.
              </p>
              <ul className="mt-8 grid gap-3 text-sm">
                {['Normal-only training, no test-set leakage', 'Baseline vs CNN autoencoder on identical splits', 'Measured model and end-to-end latency'].map((t) => (
                  <li key={t} className="flex items-center gap-3">
                    <Check aria-hidden className="size-4 shrink-0 text-normal-on-dark" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative grid content-start gap-3 sm:grid-cols-2">
              {[
                ['ROC AUC', 'Held-out test set'],
                ['pAUC', 'Low false-positive region'],
                ['Inference latency', 'Per 3 s window, on GPU'],
                ['False alerts / hour', 'Simulated monitoring'],
              ].map(([label, note], i) => (
                <div key={label} data-reveal style={delay(200 + i * 100)} className="rounded-[var(--radius-inner)] bg-navy-raised/90 p-5 backdrop-blur">
                  <p className="text-xs text-on-dark-muted">{label}</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-on-dark-muted">Pending</p>
                  <p className="mt-1 text-[11px] text-on-dark-muted">{note}</p>
                </div>
              ))}
              <p className="flex items-start gap-2 text-xs text-on-dark-muted sm:col-span-2">
                <Cpu aria-hidden className="mt-0.5 size-4 shrink-0" />
                Results will be filled in from the evaluation report (dataset, split, date). No figure on this page is estimated.
              </p>
            </div>
          </div>
        </section>

        {/* Does / does not */}
        <section className="mx-auto max-w-[1280px] px-4 pb-20 sm:px-6 lg:px-8 lg:pb-28">
          <div className="grid gap-4 md:grid-cols-2">
            <div data-reveal className="rounded-[var(--radius-card)] border border-line bg-surface p-7 sm:p-8">
              <Eyebrow>What it does</Eyebrow>
              <ul className="mt-5 grid gap-3 text-sm">
                {[
                  'Listens through an authorised microphone while monitoring is on',
                  'Scores rolling audio windows against a learned reference',
                  'Shows live waveform, spectrogram and score trend',
                  'Raises one alert after repeated unusual windows',
                  'Shows model version and measured results, never invented ones',
                ].map((t) => (
                  <li key={t} className="flex gap-3"><Plus aria-hidden className="mt-0.5 size-4 shrink-0 text-normal" />{t}</li>
                ))}
              </ul>
            </div>
            <div data-reveal style={delay(120)} className="rounded-[var(--radius-card)] border border-line bg-surface p-7 sm:p-8">
              <Eyebrow>What it does not do (yet)</Eyebrow>
              <ul className="mt-5 grid gap-3 text-sm text-ink-muted">
                {[
                  'Predict the date or probability of failure',
                  'Name the exact mechanical fault',
                  'Monitor a whole factory from one microphone',
                  'Keep running after the browser tab closes',
                  'Stop equipment or replace a technician',
                ].map((t) => (
                  <li key={t} className="flex gap-3"><Minus aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-faint" />{t}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 border-t border-line bg-surface">
          <div className="mx-auto grid max-w-[1280px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.4fr] lg:px-8 lg:py-28">
            <SectionTitle eyebrow="FAQ">Here are a few things you might be wondering.</SectionTitle>
            <div data-reveal style={delay(120)} className="divide-y divide-line border-y border-line">
              {FAQ.map(([q, a]) => (
                <details key={q} className="group py-1">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-base font-medium transition-colors hover:text-teal [&::-webkit-details-marker]:hidden">
                    {q}
                    <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full border border-line-strong text-ink-muted transition-all duration-300 group-open:rotate-45 group-open:bg-ink group-open:text-white">
                      <Plus className="size-4" />
                    </span>
                  </summary>
                  <p className="fade-up pb-5 pr-12 text-sm leading-relaxed text-ink-muted">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div data-reveal className="relative mx-auto flex max-w-[1280px] flex-col items-start justify-between gap-8 overflow-hidden rounded-[32px] bg-teal p-8 text-white sm:p-12 lg:flex-row lg:items-end lg:p-16">
            <div aria-hidden className="eq pointer-events-none absolute top-8 right-10 hidden h-24 items-end gap-2 opacity-20 lg:flex">
              {[0, 220, 440, 120, 330, 550, 80].map((d) => (
                <span key={d} className="w-3 rounded-full bg-white" style={{ height: '100%', '--d': `${d}ms` } as CSSProperties} />
              ))}
            </div>
            <div className="relative">
              <h2 className="max-w-2xl text-[clamp(2rem,4vw,3.5rem)] leading-[1] font-semibold tracking-[-0.04em]">
                See a sustained anomaly raise exactly one alert.
              </h2>
              <p className="mt-4 max-w-lg text-teal-soft">
                The console runs in your browser. Use demo audio, switch scenarios and watch a single spike get ignored.
              </p>
            </div>
            <div className="relative flex flex-wrap gap-3">
              <CTA href="/signin" variant="light">
                Get started
                <ArrowRight aria-hidden className="size-4" />
              </CTA>
              <a href={REPO} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center gap-2 rounded-full border border-white/40 px-6 text-sm font-semibold text-white transition-colors hover:bg-white/10">
                <Code2 aria-hidden className="size-4" />
                Source
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-start justify-between gap-4 px-4 py-8 text-xs text-ink-faint sm:px-6 lg:px-8">
          <p className="flex max-w-xl items-start gap-3">
            <LogoMark className="size-8 shrink-0" />
            Experimental acoustic anomaly detector built for the AMD Developer Hackathon: ACT III. Not a certified safety system,
            fault diagnosis service or failure predictor. Imagery is AI-generated.
          </p>
          <p>Research data: DCASE 2020 Task 2 · MIMII</p>
        </div>
      </footer>
    </div>
  );
}
