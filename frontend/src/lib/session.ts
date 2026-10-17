import { clearCredentials, saveCredentials } from './credentials';
import { authConfigured, supabase } from './supabase';

/** Opens a workspace as a signed-in member (full reload so the console starts with that access). */
export function open(w: { id: string; name: string }) {
  saveCredentials({ projectId: w.id, projectName: w.name, member: true });
  location.assign('/app');
}

export async function signOut() {
  clearCredentials();
  if (authConfigured) await supabase().auth.signOut().catch(() => undefined);
  location.assign('/signin');
}
