import { useEffect, useState } from 'react';
import { accounts } from '../api';
import { AuthShell, Field, FormError, Notice, go } from '../components/auth/AuthShell';
import { Button } from '../components/ui/primitives';
import { saveCredentials } from '../lib/credentials';
import { authConfigured, googleEnabled, signInWithGoogle, supabase } from '../lib/supabase';

export function SignIn() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'account' | 'guest' | 'google' | null>(null);
  const [google, setGoogle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!authConfigured) return;
    void supabase().auth.getSession().then(({ data }) => data.session && go('/workspaces'));
    void googleEnabled().then(setGoogle);
  }, []);

  async function withGoogle() {
    setBusy('google');
    setError(null);
    try {
      await signInWithGoogle(); // leaves the page for Google
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

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
        {google && (
          <>
            <Button onClick={() => void withGoogle()} disabled={busy !== null} className="gap-2.5">
              <svg aria-hidden viewBox="0 0 24 24" className="size-4">
                <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
                <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
                <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
                <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
              </svg>
              {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
            </Button>
            <div className="flex items-center gap-3 text-xs text-ink-faint">
              <span className="h-px flex-1 bg-line" /> or with e-mail <span className="h-px flex-1 bg-line" />
            </div>
          </>
        )}
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
            <Field label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
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
