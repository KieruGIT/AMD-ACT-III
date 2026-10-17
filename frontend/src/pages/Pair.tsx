import { useEffect, useState } from 'react';
import { accounts } from '../api';
import { AuthShell, Field, FormError, go } from '../components/auth/AuthShell';
import { Button } from '../components/ui/primitives';
import { saveCredentials } from '../lib/credentials';
import type { PairedDevice } from '../types/monitoring';

/** A readable default name for this device, e.g. "iPhone · Safari" (the person can change it). */
function deviceName() {
  const ua = navigator.userAgent;
  const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return browser ? `${kind} · ${browser}` : kind;
}

/** Formats what is typed as XXXX-XXXX (the backend ignores case and the dash). */
function tidy(raw: string) {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

export function Pair() {
  // QR codes carry the code in the fragment (#code=...), which never reaches a server log.
  const [code, setCode] = useState(() => tidy(new URLSearchParams(location.hash.slice(1)).get('code') ?? ''));
  const [name, setName] = useState(deviceName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<PairedDevice | null>(null); // paired, waiting for an admin to approve

  useEffect(() => {
    if (location.hash) history.replaceState(null, '', location.pathname);
  }, []);

  // While waiting: ask every 2 s whether an admin has approved (or rejected) this device.
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => {
      try {
        const { status } = await accounts.pairStatus(waiting.project_id, waiting.device_key);
        if (status === 'approved') {
          clearInterval(t);
          saveCredentials({ projectId: waiting.project_id, projectName: waiting.project_name, deviceKey: waiting.device_key, deviceName: waiting.device_name });
          go('/app');
        } else if (status !== 'pending') {
          clearInterval(t);
          setWaiting(null);
          setCode('');
          setError(status === 'rejected' ? 'The admin declined this device.' : 'Nobody approved it within 10 minutes. Ask for a new code.');
        }
      } catch {
        // network blip: keep waiting
      }
    }, 2000);
    return () => clearInterval(t);
  }, [waiting]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setWaiting(await accounts.pair(code, name.trim() || undefined));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Pair this device"
      intro="Turns this phone or computer into a listening device for one machine. Get a code from a workspace admin: Devices → Add."
    >
      {waiting ? (
        <div role="status" className="grid justify-items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-6 text-center">
          <span aria-hidden className="size-3 animate-pulse rounded-full bg-teal" />
          <p className="text-lg font-semibold">Waiting for approval…</p>
          <p className="text-sm text-ink-muted">
            Ask your admin to accept <span className="font-semibold text-ink">{waiting.device_name}</span> in {waiting.project_name}. This page
            continues by itself.
          </p>
        </div>
      ) : (
      <form onSubmit={submit} className="grid gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6">
        <label className="grid gap-1.5">
          <span className="text-sm font-semibold">Pairing code</span>
          <input
            value={code}
            onChange={(e) => setCode(tidy(e.target.value))}
            placeholder="ABCD-EFGH"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            required
            className="num min-h-14 rounded-xl border border-line-strong bg-surface px-4 text-center text-2xl font-semibold tracking-[0.2em] outline-none focus:border-teal focus:ring-2 focus:ring-teal/20"
          />
          <span className="text-xs text-ink-faint">8 characters, valid for 10 minutes, works once.</span>
        </label>
        <Field label="Name for this device" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} hint="Shown to the admin who approves it." />
        <FormError>{error}</FormError>
        <Button type="submit" variant="primary" disabled={busy || code.replace('-', '').length !== 8}>
          {busy ? 'Pairing…' : 'Pair device'}
        </Button>
      </form>
      )}
      <p className="mt-5 text-center text-xs leading-relaxed text-ink-faint">
        Place the device near the machine and keep this page open while it listens. Audio is analysed in windows and never stored.
      </p>
    </AuthShell>
  );
}
