// How this browser is allowed into a workspace. One of:
//   member  - signed in (Supabase session) and opened one of their workspaces
//   guest   - temporary guest workspace (key from POST /guest; the workspace is deleted after 2 h)
//   device  - paired as a listening device (key from POST /pair, entered once with a pairing code)
//   viewer  - legacy watch link printed by the admin CLI: /app?project=<id>#viewer=<key>
// Legacy device links (/app?project=<id>#device=<key>) still work. Keys from links travel in the URL fragment
// (never sent to servers), are stored on this device only, and are stripped from the address bar immediately.

export interface Credentials {
  projectId: string;
  projectName?: string;
  deviceKey?: string;
  deviceName?: string;
  viewerKey?: string;
  guestKey?: string;
  expiresAt?: string;
  member?: boolean;
}

const KEY = 'msm:credentials';

function read(): Credentials | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Credentials) : null;
  } catch {
    return null;
  }
}

export function saveCredentials(creds: Credentials) {
  try {
    localStorage.setItem(KEY, JSON.stringify(creds));
  } catch {
    // private mode: nothing persists; the next page load starts signed out
  }
}

export function loadCredentials(): Credentials | null {
  const url = new URL(location.href);
  const projectId = url.searchParams.get('project');
  const hash = new URLSearchParams(url.hash.slice(1));
  const deviceKey = hash.get('device') ?? undefined;
  const viewerKey = hash.get('viewer') ?? undefined;

  if (projectId && (deviceKey || viewerKey)) {
    const creds: Credentials = { projectId, ...(deviceKey ? { deviceKey } : { viewerKey }) };
    saveCredentials(creds);
    history.replaceState(null, '', `${url.pathname}?project=${encodeURIComponent(projectId)}`);
    return creds;
  }
  const saved = read();
  if (saved?.guestKey && saved.expiresAt && Date.parse(saved.expiresAt) < Date.now()) {
    clearCredentials(); // the guest workspace no longer exists
    return null;
  }
  return saved && (!projectId || saved.projectId === projectId) ? saved : null;
}

export function clearCredentials() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}

export const credentials = loadCredentials();
