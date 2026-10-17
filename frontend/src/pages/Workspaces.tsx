import { useEffect, useState } from 'react';
import { accounts } from '../api';
import { AuthShell, FormError, go } from '../components/auth/AuthShell';
import { lastWorkspace, open } from '../lib/session';
import { authConfigured, supabase } from '../lib/supabase';

/**
 * After sign-in: open the workspace used last (or the first one), creating "My workspace" for a new account. Switching
 * and creating workspaces happen in the console's sidebar.
 */
export function Workspaces() {
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
