import { BellOff, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { httpClient } from '../../api';
import { supabase } from '../../lib/supabase';
import type { AuditEntry, Invitation, Member, Role } from '../../types/monitoring';
import { FormError, Notice } from '../auth/AuthShell';
import { Button, Panel } from '../ui/primitives';
import { RowMenu, type RowAction } from '../ui/RowMenu';

const RANK: Record<Role, number> = { viewer: 1, admin: 2, owner: 3 };
const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', viewer: 'Viewer' };

const ACTION: Record<string, string> = {
  'workspace.created': 'created the workspace',
  'member.invited': 'invited',
  'member.invitation_cancelled': 'cancelled the invitation for',
  'member.role_changed': 'changed a role:',
  'member.removed': 'removed',
  'member.left': 'left the workspace',
  'device.pairing_code_created': 'created a pairing code for',
  'device.paired': 'paired',
  'device.revoked': 'removed device',
  'alerts.email_on': 'turned alert e-mails on',
  'alerts.email_off': 'turned alert e-mails off',
  'alert.acknowledged': 'acknowledged an alert',
};

function ago(at: string) {
  const m = Math.round((Date.now() - Date.parse(at)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * Who is in the workspace. "+ Add" takes an e-mail and a role: they get an invitation e-mail and join when they sign
 * in with that address. Every member gets alert e-mails (they can turn them off for themselves). Admins also see the
 * latest activity here.
 */
export function MembersCard({ myRole, isGuest }: { myRole: Role; isGuest: boolean }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [log, setLog] = useState<AuditEntry[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const api = httpClient!.account;
  const isAdmin = RANK[myRole] >= RANK.admin;

  const load = useCallback(async () => {
    try {
      if (!isGuest) {
        const r = await api.members();
        setMembers(r.members);
        setInvitations(r.invitations);
      }
      if (isAdmin) setLog((await api.audit()).slice(0, 4));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [api, isAdmin, isGuest]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 20_000);
    if (!isGuest) void supabase().auth.getSession().then(({ data }) => setMe(data.session?.user.id ?? null));
    return () => clearInterval(t);
  }, [load, isGuest]);

  async function act(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const grantable = (['viewer', 'admin', 'owner'] as Role[]).filter((r) => RANK[r] <= RANK[myRole]);

  function memberActions(m: Member): RowAction[] {
    const self = m.user_id === me;
    const out: RowAction[] = [];
    if (myRole === 'owner' && !self) {
      for (const r of ['owner', 'admin', 'viewer'] as Role[]) {
        out.push({ label: `Make ${ROLE_LABEL[r].toLowerCase()}`, current: m.role === r, onClick: () => void act(() => api.changeRole(m.user_id, r)) });
      }
    }
    if (self) {
      out.push({ label: 'Leave workspace', danger: true, onClick: () => void act(async () => (await api.removeMember(m.user_id), location.assign('/workspaces'))) });
    } else if (isAdmin && (m.role !== 'owner' || myRole === 'owner')) {
      out.push({ label: 'Remove from workspace', danger: true, onClick: () => void act(() => api.removeMember(m.user_id)) });
    }
    return out;
  }

  return (
    <Panel
      title="Members"
      labelledBy="members-title"
      actions={
        isAdmin && !isGuest && !adding ? (
          <Button variant="ghost" className="min-h-9 gap-1 px-3 text-xs" onClick={() => (setAdding(true), setNotice(null))}>
            <Plus aria-hidden className="size-3.5" />
            Add
          </Button>
        ) : undefined
      }
    >
      {isGuest ? (
        <p className="text-sm text-ink-muted">
          Guest workspaces are private to this browser and send no e-mails.{' '}
          <a href="/signin" className="font-semibold text-teal hover:underline">
            Create an account
          </a>{' '}
          to add members.
        </p>
      ) : (
        <>
          {adding && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const to = email.trim();
                void act(async () => {
                  await api.invite(to, role);
                  setEmail('');
                  setAdding(false);
                }, `Invitation sent to ${to}.`);
              }}
              className="mb-3 flex flex-wrap gap-2"
            >
              <input
                type="email"
                required
                autoFocus
                placeholder="name@company.com"
                aria-label="E-mail address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="min-h-10 min-w-0 flex-1 basis-40 rounded-xl border border-line-strong bg-surface px-3 text-sm"
              />
              <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="min-h-10 rounded-xl border border-line-strong bg-surface px-2 text-sm">
                {grantable.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="primary" className="min-h-10 px-4" disabled={busy}>
                Add
              </Button>
              <Button variant="ghost" className="min-h-10 px-3" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </form>
          )}

          <ul className="grid gap-1">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center gap-3 py-1.5">
                <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-teal-soft text-xs font-semibold text-teal">
                  {m.email.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {m.email}
                    {m.user_id === me && <span className="ml-1.5 text-xs font-normal text-ink-faint">you</span>}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-ink-faint">
                    {ROLE_LABEL[m.role]}
                    {m.email_alerts === false && (
                      <>
                        {' · '}
                        <BellOff aria-hidden className="size-3" />
                        alert e-mails off
                      </>
                    )}
                  </span>
                </span>
                <RowMenu label={`More for ${m.email}`} disabled={busy} actions={memberActions(m)} />
              </li>
            ))}
            {invitations.map((i) => (
              <li key={i.email} className="flex items-center gap-3 py-1.5">
                <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full border border-dashed border-line-strong text-xs text-ink-faint">
                  {i.email.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink-muted">{i.email}</span>
                  <span className="block text-xs text-ink-faint">Invited · {ROLE_LABEL[i.role]}</span>
                </span>
                {isAdmin && (
                  <RowMenu
                    label={`More for ${i.email}`}
                    disabled={busy}
                    actions={[{ label: 'Cancel invitation', danger: true, onClick: () => void act(() => api.cancelInvitation(i.email)) }]}
                  />
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-faint">Members get alert e-mails at the address they sign in with.</p>
        </>
      )}
      <FormError>{error}</FormError>
      <Notice>{notice}</Notice>

      {isAdmin && log.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="eyebrow text-ink-faint">Recent activity</p>
          <ul className="mt-2 grid gap-1.5">
            {log.map((e, i) => (
              <li key={i} className="text-xs leading-snug text-ink-muted">
                <span className="font-semibold text-ink">{e.actor}</span> {ACTION[e.action] ?? e.action}
                {e.detail ? ` ${e.detail}` : ''} <span className="text-ink-faint">· {ago(e.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
