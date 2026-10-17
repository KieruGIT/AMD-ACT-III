import { useEffect, useState } from 'react';
import { accounts } from '../api';
import { AuthShell, Field, FormError, Notice, go } from '../components/auth/AuthShell';
import { Button } from '../components/ui/primitives';
import { saveCredentials } from '../lib/credentials';
import { authConfigured, supabase } from '../lib/supabase';

export function SignIn() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'account' | 'guest' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!authConfigured) return;
    void supabase().auth.getSession().then(({ data }) => data.session && go('/workspaces'));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy('account');
    setError(null);
    setNotice(null);
    try {
      const auth = supabase().auth;
      if (mode === 'signin') {
        const { error: err } = await auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw err;
        go('/workspaces');
      } else {
        const { data, error: err } = await auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${location.origin}/workspaces` } });
        if (err) throw err;
        if (data.session) go('/workspaces');
        else {
          setNotice(`Check ${email.trim()} for a confirmation link, then sign in.`);
          setMode('signin');
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function guest() {
    setBusy('guest');
    setError(null);
    try {
      const g = await accounts.startGuest();
      saveCredentials({ projectId: g.project_id, projectName: 'Guest workspace', guestKey: g.guest_key, expiresAt: g.expires_at });
      go('/app');
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  return (
    <AuthShell
      title={mode === 'signin' ? 'Sign in to your workspace' : 'Create your account'}
      intro="Workspaces hold your machines' listening devices, alert history, team and e-mail alerts."
    >
      <div className="grid gap-5 rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6">
        {authConfigured ? (
          <form onSubmit={submit} className="grid gap-4">
            <div role="tablist" aria-label="Account" className="grid grid-cols-2 gap-1 rounded-full bg-surface-muted p-1">
              {(['signin', 'signup'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => {
                    setMode(m);
                    setError(null);
                  }}
                  className={`min-h-9 rounded-full text-sm font-semibold ${mode === m ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted'}`}
                >
                  {m === 'signin' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>
            <Field label="Work e-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <Field
              label="Password"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
            />
            <FormError>{error}</FormError>
            <Notice>{notice}</Notice>
            <Button type="submit" variant="primary" disabled={busy !== null}>
              {busy === 'account' ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
        ) : (
          <FormError>{error}</FormError>
        )}

        {authConfigured && (
          <div className="flex items-center gap-3 text-xs text-ink-faint">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
        )}

        <div className="grid gap-2">
          <Button onClick={() => void guest()} disabled={busy !== null}>
            {busy === 'guest' ? 'Preparing a guest workspace…' : 'Continue as guest'}
          </Button>
          <p className="text-center text-xs text-ink-faint">No account. Nothing is kept: the guest workspace is deleted after 2 hours.</p>
        </div>
      </div>

      <p className="mt-5 text-center text-sm text-ink-muted">
        Setting up a phone or sensor at a machine?{' '}
        <a href="/pair" className="font-semibold text-teal underline-offset-4 hover:underline">
          Enter a pairing code
        </a>
      </p>
    </AuthShell>
  );
}
