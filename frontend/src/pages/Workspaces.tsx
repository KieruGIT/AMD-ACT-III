import { Folder, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { accounts } from '../api';
import { AuthShell, Field, FormError, go } from '../components/auth/AuthShell';
import { Button } from '../components/ui/primitives';
import { createGuestWorkspace, guestWorkspaces, openGuest } from '../lib/guest';
import { lastWorkspace, open } from '../lib/session';
import { authConfigured, supabase } from '../lib/supabase';

/**
 * After sign-in: open the workspace used last (or the first one), creating "My workspace" for a new account. Switching
 * and creating workspaces happen in the console's sidebar. Guests (?guest) start empty and name their own.
 */
export function Workspaces() {
  if (new URLSearchParams(location.search).has('guest')) return <GuestWorkspaces />;
  return <MemberWorkspaces />;
}

function MemberWorkspaces() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!authConfigured || !(await supabase().auth.getSession()).data.session) return go('/signin');
      try {
        const m = await accounts.me();
        const pick = m.workspaces.find((w) => w.id === lastWorkspace()) ?? m.workspaces[0];
        open(pick ?? (await accounts.createWorkspace('My workspace')));
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  return (
    <AuthShell title="Opening your workspace" intro="One moment…">
      <FormError>{error}</FormError>
    </AuthShell>
  );
}

function GuestWorkspaces() {
  const list = guestWorkspaces();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createGuestWorkspace(name.trim());
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Your workspaces"
      intro="A workspace is a folder for the machines you monitor, e.g. one per room or site. As a guest nothing is kept: each workspace is deleted 2 hours after you make it."
    >
      <div className="grid gap-5">
        {list.length > 0 ? (
          <ul aria-label="Guest workspaces" className="grid gap-1.5">
            {list.map((w) => (
              <li key={w.projectId}>
                <button
                  type="button"
                  onClick={() => openGuest(w)}
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 text-left hover:bg-surface-muted"
                >
                  <Folder aria-hidden className="size-4 shrink-0 text-teal" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{w.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-muted">No workspaces yet.</p>
        )}

        <form onSubmit={(e) => void create(e)} className="grid gap-3">
          <Field
            label="New workspace"
            placeholder="e.g. Workshop, Server room"
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength={2}
            maxLength={60}
            required
            autoFocus
          />
          <Button type="submit" variant="primary" disabled={busy || name.trim().length < 2} className="gap-1.5">
            <Plus aria-hidden className="size-4" />
            {busy ? 'Creating…' : 'Create workspace'}
          </Button>
          <FormError>{error}</FormError>
        </form>
      </div>
    </AuthShell>
  );
}
