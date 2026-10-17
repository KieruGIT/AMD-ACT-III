import { useEffect, useState } from 'react';
import { accounts } from '../api';
import { AuthShell, FormError, go } from '../components/auth/AuthShell';
import { Button } from '../components/ui/primitives';
import { saveCredentials } from '../lib/credentials';

/** Formats what is typed as XXXX-XXXX (the backend ignores case and the dash). */
function tidy(raw: string) {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

export function Pair() {
  // QR codes carry the code in the fragment (#code=...), which never reaches a server log.
  const [code, setCode] = useState(() => tidy(new URLSearchParams(location.hash.slice(1)).get('code') ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (location.hash) history.replaceState(null, '', location.pathname);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = await accounts.pair(code);
      saveCredentials({ projectId: d.project_id, projectName: d.project_name, deviceKey: d.device_key, deviceName: d.device_name });
      go('/app');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Pair this device"
      intro="Turns this phone or computer into a listening device for one machine. Get a code from a workspace admin: Workspace → Devices → Add device."
    >
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
        <FormError>{error}</FormError>
        <Button type="submit" variant="primary" disabled={busy || code.replace('-', '').length !== 8}>
          {busy ? 'Pairing…' : 'Pair device'}
        </Button>
      </form>
      <p className="mt-5 text-center text-xs leading-relaxed text-ink-faint">
        Place the device near the machine and keep this page open while it listens. Audio is analysed in windows and never stored.
      </p>
    </AuthShell>
  );
}
