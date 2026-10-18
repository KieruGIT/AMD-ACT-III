import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Sign-in only: the browser never reads the database directly (row-level security denies it).
// All workspace data goes through the backend, which verifies the Supabase session token.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const authConfigured = !!(url && key);

let instance: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!authConfigured) throw new Error('Sign-in is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).');
  // pkce: Google sign-in returns with ?code=..., exchanged on the next page that reads the session
  instance ??= createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'msm:auth', flowType: 'pkce' } });
  return instance;
}

/** Current access token (refreshed when needed), or null when signed out. */
export async function accessToken(): Promise<string | null> {
  if (!authConfigured) return null;
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? null;
}

/** Whether Google sign-in is switched on in Supabase (Authentication → Providers → Google). Public settings call. */
export async function googleEnabled(): Promise<boolean> {
  if (!authConfigured) return false;
  try {
    const r = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key! } });
    return !!(await r.json())?.external?.google;
  } catch {
    return false;
  }
}

/** Opens Google's account picker; comes back to /workspaces, which opens the user's workspace. */
export async function signInWithGoogle() {
  const { error } = await supabase().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/workspaces` } });
  if (error) throw error;
}
