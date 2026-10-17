import { clearCredentials, saveCredentials } from './credentials';
import { authConfigured, supabase } from './supabase';

const LAST = 'msm:last-workspace';

/** Opens a workspace as a signed-in member (full reload so the console starts with that access). */
export function open(w: { id: string; name: string }) {
  saveCredentials({ projectId: w.id, projectName: w.name, member: true });
  try {
    localStorage.setItem(LAST, w.id);
  } catch {
    // private mode: next sign-in opens the first workspace
  }
  location.assign('/app');
}

export function lastWorkspace(): string | null {
  try {
    return localStorage.getItem(LAST);
  } catch {
    return null;
  }
}

export async function signOut() {
  clearCredentials();
  if (authConfigured) await supabase().auth.signOut().catch(() => undefined);
  location.assign('/signin');
}
