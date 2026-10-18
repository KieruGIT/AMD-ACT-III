import { BellOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { httpClient } from '../../api';
import { supabase } from '../../lib/supabase';
import type { Invitation, Member, Role } from '../../types/monitoring';
import { FormError, Notice } from '../auth/AuthShell';
import { Modal } from '../ui/Modal';
import { Button, Panel } from '../ui/primitives';
import { RowMenu, type RowAction } from '../ui/RowMenu';

const RANK: Record<Role, number> = { viewer: 1, admin: 2, owner: 3 };
// Plain words: viewers watch and get alerts; editors also manage devices and members; owners also manage owners.
const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Can edit', viewer: 'Can view' };

/**
 * Who is in the workspace. "+ Add" takes an e-mail and a role: they get an invitation e-mail and join when they sign
 * in with that address. Every member gets alert e-mails (they can turn them off for themselves).
 */
export function MembersCard({ myRole, isGuest, addSignal = 0 }: { myRole: Role; isGuest: boolean; addSignal?: number }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const api = httpClient!.account;
  const isAdmin = RANK[myRole] >= RANK.admin;

  // the workspace's "Add member" button opens the same pop-up
  useEffect(() => {
    if (addSignal) setAdding(true);
  }, [addSignal]);

  const load = useCallback(async () => {
    try {
      if (!isGuest) {
        const r = await api.members();
        setMembers(r.members);
        setInvitations(r.invitations);
      }
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

  const grantable = (['viewer', 'admin'] as Role[]).filter((r) => RANK[r] <= RANK[myRole]); // owner: from the ⋯ menu

  function memberActions(m: Member): RowAction[] {
    const self = m.user_id === me;
    const out: RowAction[] = [];
    if (myRole === 'owner' && !self) {
      for (const r of ['viewer', 'admin', 'owner'] as Role[]) {
        out.push({ label: r === 'owner' ? 'Make owner' : ROLE_LABEL[r], current: m.role === r, onClick: () => void act(() => api.changeRole(m.user_id, r)) });
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
    >
      {isGuest ? (
        <p className="text-sm text-ink-muted">Guest workspaces are private to this browser and send no e-mails.</p>
      ) : (
        <>
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
          <p className="mt-3 text-xs text-ink-faint">
            Everyone here gets alert e-mails at the address they sign in with. <span className="text-ink-muted">Can view</span>: watch and
            acknowledge alerts. <span className="text-ink-muted">Can edit</span>: also add or remove devices and members.
          </p>
        </>
      )}
      <FormError>{error}</FormError>
      <Notice>{notice}</Notice>

      <Modal open={adding} title="Add a member" onClose={() => setAdding(false)}>
        {isGuest ? (
          <div className="grid gap-3 text-sm">
            <p className="font-semibold">Create an account to invite people</p>
            <p className="text-ink-muted">Members are invited by e-mail and get alert e-mails, so they need a workspace that belongs to an account.</p>
            <a href="/signin" className="inline-flex min-h-11 items-center justify-center rounded-full bg-teal px-4 text-sm font-semibold text-white hover:bg-teal-strong">
              Create an account
            </a>
          </div>
        ) : (
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
              className="grid gap-3"
            >
              <input
                type="email"
                required
                autoFocus
                placeholder="name@company.com"
                aria-label="E-mail address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="min-h-11 rounded-xl border border-line-strong bg-surface px-3 text-sm"
              />
              <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="min-h-11 rounded-xl border border-line-strong bg-surface px-2 text-sm">
                {grantable.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-ink-faint">
                They get an invitation e-mail, join when they sign in with that address, and then get alert e-mails too.
                Can view: watch and acknowledge alerts. Can edit: also add or remove devices and members.
              </p>
              <Button type="submit" variant="primary" className="min-h-11" disabled={busy}>
                {busy ? 'Adding…' : 'Add member'}
              </Button>
            </form>
                  )}
        <FormError>{error}</FormError>
      </Modal>
    </Panel>
  );
}
