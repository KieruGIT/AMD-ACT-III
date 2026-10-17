import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Sign-in only: the browser never reads the database directly (row-level security denies it).
// All workspace data goes through the backend, which verifies the Supabase session token.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const authConfigured = !!(url && key);

let instance: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!authConfigured) throw new Error('Sign-in is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).');
  instance ??= createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'msm:auth' } });
  return instance;
}

/** Current access token (refreshed when needed), or null when signed out. */
export async function accessToken(): Promise<string | null> {
  if (!authConfigured) return null;
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? null;
}
