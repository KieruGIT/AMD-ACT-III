import { accounts } from '../api';
import { saveCredentials } from './credentials';

// A guest has no account: the workspaces they make live only in this browser (and on the server for 2 h).
const KEY = 'msm:guest-workspaces';

export interface GuestWorkspace {
  projectId: string;
  name: string;
  guestKey: string;
  expiresAt: string;
}

export function guestWorkspaces(): GuestWorkspace[] {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '[]') as GuestWorkspace[];
    return all.filter((w) => Date.parse(w.expiresAt) > Date.now());
  } catch {
    return [];
  }
}

function save(list: GuestWorkspace[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // private mode: only the open workspace is remembered
  }
}

export function openGuest(w: GuestWorkspace) {
  saveCredentials({ projectId: w.projectId, projectName: w.name, guestKey: w.guestKey, expiresAt: w.expiresAt });
  location.assign('/app');
}

export async function createGuestWorkspace(name: string) {
  const g = await accounts.startGuest(name);
  const w = { projectId: g.project_id, name: g.name, guestKey: g.guest_key, expiresAt: g.expires_at };
  save([...guestWorkspaces(), w]);
  openGuest(w);
}

export function renameGuestWorkspace(projectId: string, name: string) {
  save(guestWorkspaces().map((w) => (w.projectId === projectId ? { ...w, name } : w)));
}

export function forgetGuestWorkspace(projectId: string) {
  save(guestWorkspaces().filter((w) => w.projectId !== projectId));
}

export function forgetAllGuestWorkspaces() {
  save([]);
}
