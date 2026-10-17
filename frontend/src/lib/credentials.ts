// Project credentials arrive once via the setup link printed by the backend admin CLI:
//   /app?project=<id>#device=<key>   (listening device)
//   /app?project=<id>#viewer=<key>   (dashboard watcher)
// The key travels in the URL fragment (never sent to servers), is stored on this device only,
// and is stripped from the address bar immediately.

export interface Credentials {
  projectId: string;
  deviceKey?: string;
  viewerKey?: string;
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

export function loadCredentials(): Credentials | null {
  const url = new URL(location.href);
  const projectId = url.searchParams.get('project');
  const hash = new URLSearchParams(url.hash.slice(1));
  const deviceKey = hash.get('device') ?? undefined;
  const viewerKey = hash.get('viewer') ?? undefined;

  if (projectId && (deviceKey || viewerKey)) {
    const prev = read();
    const creds: Credentials = { ...(prev?.projectId === projectId ? prev : {}), projectId, ...(deviceKey && { deviceKey }), ...(viewerKey && { viewerKey }) };
    try {
      localStorage.setItem(KEY, JSON.stringify(creds));
    } catch {
      // private mode: credentials still work for this page load
    }
    history.replaceState(null, '', `${url.pathname}?project=${encodeURIComponent(projectId)}`);
    return creds;
  }
  const saved = read();
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
