import { useEffect, useState } from 'react';
import { accounts } from '../api';
import { AuthShell, FormError, go } from '../components/auth/AuthShell';
import { createGuestWorkspace, guestWorkspaces, openGuest } from '../lib/guest';
import { lastWorkspace, open } from '../lib/session';
import { authConfigured, supabase } from '../lib/supabase';

/**
 * After sign-in: open the workspace used last (or the first one), creating "My workspace" for a new account. Switching
 * and creating workspaces happen in the console's sidebar. Guests (?guest) open their first guest workspace, or start
 * with an empty one named "Workspace".
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

let guestStarted = false; // React may run the effect twice in development: make one workspace, not two

function GuestWorkspaces() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (guestStarted) return;
    guestStarted = true;
    const [first] = guestWorkspaces();
    if (first) return openGuest(first);
    createGuestWorkspace('Workspace').catch((err: Error) => setError(err.message));
  }, []);

  return (
    <AuthShell title="Opening your workspace" intro="One moment…">
      <FormError>{error}</FormError>
    </AuthShell>
  );
}
