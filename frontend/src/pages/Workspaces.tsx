import { ArrowRight, Building2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { accounts } from '../api';
import { AuthShell, Field, FormError, go } from '../components/auth/AuthShell';
import { Button } from '../components/ui/primitives';
import { open, signOut } from '../lib/session';
import { authConfigured, supabase } from '../lib/supabase';
import type { Me } from '../types/monitoring';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', viewer: 'Viewer' } as const;

export function Workspaces() {
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ?choose keeps the list open even with one workspace (the console's "Switch workspace")
  const choosing = new URLSearchParams(location.search).has('choose');

  useEffect(() => {
    (async () => {
      if (!authConfigured || !(await supabase().auth.getSession()).data.session) return go('/signin');
      try {
        const m = await accounts.me();
        if (m.workspaces.length === 1 && !choosing) return open(m.workspaces[0]);
        setMe(m);
        if (m.workspaces.length === 0) setName('My workspace');
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [choosing]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      open(await accounts.createWorkspace(name.trim()));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const aside = me && (
    <div className="flex items-center gap-3 text-sm">
      <span className="hidden text-ink-muted sm:inline">{me.user.email}</span>
      <Button variant="ghost" className="min-h-9 px-3" onClick={() => void signOut()}>
        Sign out
      </Button>
    </div>
  );

  return (
    <AuthShell
      title={me?.workspaces.length ? 'Choose a workspace' : 'Create your workspace'}
      intro={
        me?.workspaces.length
          ? 'Each workspace has its own devices, team, alert history and e-mail alerts.'
          : 'A workspace is usually one site or plant. You can invite your team once it exists.'
      }
      aside={aside}
    >
      {!me && !error && <p className="text-sm text-ink-faint">Loading your workspaces…</p>}
      <FormError>{error}</FormError>

      {me && me.workspaces.length > 0 && (
        <ul className="mb-6 grid gap-2">
          {me.workspaces.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                onClick={() => open(w)}
                className="group flex min-h-16 w-full items-center gap-3 rounded-2xl border border-line-strong bg-surface px-4 text-left hover:border-ink"
              >
                <Building2 aria-hidden className="size-5 shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{w.name}</span>
                  <span className="block text-xs text-ink-faint">{ROLE_LABEL[w.role]}</span>
                </span>
                <ArrowRight aria-hidden className="size-4 text-ink-faint transition-transform group-hover:translate-x-0.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {me && (
        <form onSubmit={create} className="grid gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <Field label={me.workspaces.length ? 'New workspace' : 'Workspace name'} required minLength={2} maxLength={60}
            placeholder="e.g. Plant A" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="primary" disabled={busy || name.trim().length < 2}>
            {busy ? 'Creating…' : 'Create workspace'}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
