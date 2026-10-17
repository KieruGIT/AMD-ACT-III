import { Mail } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { httpClient } from '../../api';
import type { Recipient } from '../../types/monitoring';
import { FormError } from '../auth/AuthShell';
import { Button } from '../ui/primitives';
import { SectionNote } from './ManagePanel';

export function AlertsSection() {
  const [list, setList] = useState<Recipient[] | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const api = httpClient!.account;

  const load = useCallback(async () => {
    try {
      setList(await api.recipients());
    } catch (err) {
      setError((err as Error).message);
    }
  }, [api]);

  useEffect(() => void load(), [load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold">Who gets alert e-mails</h3>
        {list?.length === 0 && <p className="text-sm text-ink-muted">Nobody yet. Alerts only show in the console.</p>}
        <ul className="grid gap-2">
          {list?.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
              <Mail aria-hidden className="size-4 shrink-0 text-ink-faint" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{r.name}</span>
                <span className="block truncate text-xs text-ink-faint">{r.email}</span>
              </span>
              <Button variant="ghost" className="min-h-9 px-3 text-xs" disabled={busy} onClick={() => void act(() => api.removeRecipient(r.id))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await api.addRecipient(name.trim(), email.trim());
            setName('');
            setEmail('');
          });
        }}
        className="grid gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-5"
      >
        <h3 className="text-sm font-semibold">Add recipient</h3>
        <input required maxLength={60} placeholder="Name or team, e.g. Maintenance" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)}
          className="min-h-11 rounded-xl border border-line-strong bg-surface px-3 text-sm" />
        <input required type="email" placeholder="maintenance@company.com" aria-label="E-mail address" value={email} onChange={(e) => setEmail(e.target.value)}
          className="min-h-11 rounded-xl border border-line-strong bg-surface px-3 text-sm" />
        <FormError>{error}</FormError>
        <Button type="submit" variant="primary" disabled={busy}>
          Add recipient
        </Button>
        <SectionNote>
          One e-mail when a persistent anomaly opens on any device in this workspace, and one when it recovers. Not per window, so no
          flood.
        </SectionNote>
      </form>
    </div>
  );
}
