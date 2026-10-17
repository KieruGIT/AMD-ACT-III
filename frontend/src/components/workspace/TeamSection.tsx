import { useCallback, useEffect, useState } from 'react';
import { httpClient } from '../../api';
import { supabase } from '../../lib/supabase';
import type { Invitation, Member, Role } from '../../types/monitoring';
import { FormError, Notice } from '../auth/AuthShell';
import { Button } from '../ui/primitives';
import { SectionNote } from './ManagePanel';

const RANK: Record<Role, number> = { viewer: 1, admin: 2, owner: 3 };
const ROLE_HELP: Record<Role, string> = {
  owner: 'everything, including owners',
  admin: 'devices, team (except owners), e-mail alerts',
  viewer: 'watch and acknowledge alerts',
};

export function TeamSection({ myRole }: { myRole: Role }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const api = httpClient!.account;

  const load = useCallback(async () => {
    try {
      const r = await api.members();
      setMembers(r.members);
      setInvitations(r.invitations);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [api]);

  useEffect(() => {
    void load();
    void supabase().auth.getSession().then(({ data }) => setMe(data.session?.user.id ?? null));
  }, [load]);

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
  const isAdmin = RANK[myRole] >= RANK.admin;

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold">Members</h3>
        <ul className="grid gap-2">
          {members.map((m) => {
            const self = m.user_id === me;
            const canEdit = myRole === 'owner' && !self;
            const canRemove = self || (isAdmin && (m.role !== 'owner' || myRole === 'owner'));
            return (
              <li key={m.user_id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {m.email}
                    {self && <span className="ml-2 text-xs font-normal text-ink-faint">you</span>}
                  </span>
                  <span className="block text-xs text-ink-faint">{ROLE_HELP[m.role]}</span>
                </span>
                {canEdit ? (
                  <select
                    aria-label={`Role of ${m.email}`}
                    value={m.role}
                    disabled={busy}
                    onChange={(e) => void act(() => api.changeRole(m.user_id, e.target.value as Role))}
                    className="min-h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm"
                  >
                    {(['owner', 'admin', 'viewer'] as Role[]).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink-muted">{m.role}</span>
                )}
                {canRemove && (
                  <Button
                    variant="ghost"
                    className="min-h-9 px-3 text-xs"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await api.removeMember(m.user_id);
                        if (self) location.assign('/workspaces?choose');
                      })
                    }
                  >
                    {self ? 'Leave' : 'Remove'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {invitations.length > 0 && (
        <section className="grid gap-3">
          <h3 className="text-sm font-semibold">Pending invitations</h3>
          <ul className="grid gap-2">
            {invitations.map((i) => (
              <li key={i.email} className="flex items-center gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{i.email}</span>
                  <span className="block text-xs text-ink-faint">
                    {i.role} · invited by {i.invited_by}
                  </span>
                </span>
                {isAdmin && (
                  <Button variant="ghost" className="min-h-9 px-3 text-xs" disabled={busy} onClick={() => void act(() => api.cancelInvitation(i.email))}>
                    Cancel
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {isAdmin && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api.invite(email.trim(), role);
              setEmail('');
            }, `Invitation sent to ${email.trim()}.`);
          }}
          className="grid gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-5"
        >
          <h3 className="text-sm font-semibold">Invite someone</h3>
          <div className="flex flex-wrap gap-2">
            <input
              type="email"
              required
              placeholder="name@company.com"
              aria-label="E-mail address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3 text-sm"
            />
            <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="min-h-11 rounded-xl border border-line-strong bg-surface px-3 text-sm">
              {grantable.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <FormError>{error}</FormError>
          <Notice>{notice}</Notice>
          <Button type="submit" variant="primary" disabled={busy}>
            Send invitation
          </Button>
          <SectionNote>
            They get an e-mail and join by signing in (or creating an account) with that address. {ROLE_HELP[role][0].toUpperCase() + ROLE_HELP[role].slice(1)}.
          </SectionNote>
        </form>
      )}
      {!isAdmin && <FormError>{error}</FormError>}
    </div>
  );
}
