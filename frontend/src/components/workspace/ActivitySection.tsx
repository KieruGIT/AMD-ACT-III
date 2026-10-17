import { useEffect, useState } from 'react';
import { httpClient } from '../../api';
import type { AuditEntry } from '../../types/monitoring';
import { FormError } from '../auth/AuthShell';
import { SectionNote } from './ManagePanel';

const ACTION: Record<string, string> = {
  'workspace.created': 'created the workspace',
  'member.invited': 'invited',
  'member.invitation_cancelled': 'cancelled the invitation for',
  'member.joined': 'joined',
  'member.role_changed': 'changed a role:',
  'member.removed': 'removed',
  'member.left': 'left the workspace',
  'device.pairing_code_created': 'created a pairing code for',
  'device.paired': 'paired',
  'device.revoked': 'removed device',
  'alerts.recipient_added': 'added alert recipient',
  'alerts.recipient_removed': 'removed an alert recipient',
  'alert.acknowledged': 'acknowledged an alert',
};

function ago(at: string) {
  const m = Math.round((Date.now() - Date.parse(at)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function ActivitySection() {
  const [log, setLog] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    httpClient!.account.audit().then(setLog, (err: Error) => setError(err.message));
  }, []);

  return (
    <div className="grid gap-3">
      <SectionNote>Every change to this workspace: who did what, and when. Last 100 entries.</SectionNote>
      <FormError>{error}</FormError>
      {log?.length === 0 && <p className="text-sm text-ink-muted">No activity yet.</p>}
      <ol className="grid">
        {log?.map((e, i) => (
          <li key={i} className="grid gap-0.5 border-b border-line py-3 last:border-0">
            <p className="text-sm">
              <span className="font-semibold">{e.actor}</span> {ACTION[e.action] ?? e.action}
              {e.detail && e.action !== 'member.left' && <span className="text-ink-muted"> {e.detail}</span>}
            </p>
            <time dateTime={e.at} title={new Date(e.at).toLocaleString()} className="text-xs text-ink-faint">
              {ago(e.at)}
            </time>
          </li>
        ))}
      </ol>
    </div>
  );
}
