import { Plus, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { accounts, httpClient } from '../../api';
import { credentials, saveCredentials } from '../../lib/credentials';
import { formatAgo } from '../../lib/format';
import type { DeviceSummary, MachineProfile, PairingCode, ProjectOverview } from '../../types/monitoring';
import { FormError, go } from '../auth/AuthShell';
import { Modal } from '../ui/Modal';
import { Button, Panel } from '../ui/primitives';
import { RowMenu } from '../ui/RowMenu';

const ONLINE_MS = 10_000;

/**
 * The workspace's listening devices, and the one place to add, approve or remove them. "+ Add" shows a pairing code
 * and QR straight away. Whoever scans it asks to join; an admin approves it (pop-up + row here) before it can listen.
 */
export function DevicesCard({
  overview,
  profiles,
  canManage,
  addSignal,
  onChanged,
}: {
  overview: ProjectOverview;
  profiles: MachineProfile[];
  canManage: boolean;
  addSignal: number; // bumped by the monitor's "Add a device" button
  onChanged: () => void;
}) {
  const [code, setCode] = useState<PairingCode | null>(null);
  const [codeAt, setCodeAt] = useState(0);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  const [adding, setAdding] = useState(false); // the "Add a device" pop-up
  const [approvedName, setApprovedName] = useState<string | null>(null);
  const machine = profiles[0]?.id ?? 'fan_01';

  const pending = overview.devices.filter((d) => d.pending);
  const active = overview.devices
    .filter((d) => !d.pending)
    .sort((a, b) => Number(isLive(b, now)) - Number(isLive(a, now)) || a.name.localeCompare(b.name));
  const left = code ? Date.parse(code.expires_at) - now : 0;
  // the device that used this code (it asked to join after the code was made)
  const joiner = code ? pending.find((d) => Date.parse(d.created_at ?? '') >= codeAt - 2000) : undefined;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!code) return;
    void QRCode.toDataURL(`${location.origin}/pair#code=${code.code}`, { margin: 1, width: 400, color: { dark: '#111e3b', light: '#ffffff' } }).then(setQr);
  }, [code]);

  async function run(what: string, fn: () => Promise<void>) {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // A fresh name each time, so several devices stay distinguishable (the device may rename itself when it pairs).
  const nextName = () => {
    const taken = new Set(overview.devices.map((d) => d.name));
    let n = overview.devices.length + 1;
    while (taken.has(`Device ${n}`)) n++;
    return `Device ${n}`;
  };

  const add = () =>
    run('add', async () => {
      setAdding(true);
      setApprovedName(null);
      setQr(null);
      setCodeAt(Date.now());
      setCode(await httpClient!.account.pairingCode(nextName(), machine));
    });

  // The admin turns this browser into the listener themselves: no approval step needed.
  const listenHere = () =>
    run('self', async () => {
      const c = code ?? (await httpClient!.account.pairingCode('This browser', machine));
      const d = await accounts.pair(c.code, 'This browser');
      await httpClient!.account.approveDevice(d.device_id);
      // keep this browser's workspace access, so managing the workspace stays one click away
      const home = credentials ? { ...credentials, home: undefined } : undefined;
      saveCredentials({ projectId: d.project_id, projectName: d.project_name, deviceKey: d.device_key, deviceName: d.device_name, home });
      go('/app');
    });

  const act = (what: string, fn: () => Promise<unknown>) =>
    run(what, async () => {
      await fn();
      onChanged();
    });
  const approve = (d: DeviceSummary) =>
    act(`approve:${d.id}`, () => httpClient!.account.approveDevice(d.id).then(() => d.id === joiner?.id && setApprovedName(d.name)));
  const closeAdd = () => {
    setAdding(false);
    setCode(null);
    setApprovedName(null);
  };
  const reject = (d: DeviceSummary) => act(`reject:${d.id}`, () => httpClient!.account.revokeDevice(d.id));

  // The monitor's "Add a device" button opens the same pop-up.
  useEffect(() => {
    if (!addSignal || !canManage) return;
    void add();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per click
  }, [addSignal]);

  const popup = canManage && !adding ? pending.find((d) => !dismissed.has(d.id)) : undefined;

  return (
    <div>
      <Panel
        title="Devices"
        labelledBy="devices-title"
        actions={
          canManage ? (
            <Button variant="ghost" className="min-h-9 gap-1 px-3 text-xs" disabled={busy !== null} onClick={() => void add()}>
              <Plus aria-hidden className="size-3.5" />
              {busy === 'add' ? 'Creating…' : 'Add'}
            </Button>
          ) : undefined
        }
      >
        {pending.length > 0 && (
          <ul className="mb-3 grid gap-2" aria-label="Waiting for approval">
            {pending.map((d) => (
              <li key={d.id} className="grid gap-2 rounded-2xl border border-teal/30 bg-teal-soft/60 p-3">
                <span className="flex items-center gap-2 text-sm">
                  <Smartphone aria-hidden className="size-4 shrink-0 text-teal" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{d.name}</span>
                    <span className="block text-xs text-ink-muted">wants to join · {d.created_at ? formatAgo(now - Date.parse(d.created_at)) : 'just now'}</span>
                  </span>
                </span>
                {canManage ? (
                  <span className="flex gap-2">
                    <Button variant="ghost" className="min-h-9 flex-1 px-3 text-xs" disabled={busy !== null} onClick={() => void reject(d)}>
                      Reject
                    </Button>
                    <Button variant="primary" className="min-h-9 flex-1 px-3 text-xs" disabled={busy !== null} onClick={() => void approve(d)}>
                      Approve
                    </Button>
                  </span>
                ) : (
                  <span className="text-xs text-ink-faint">Waiting for an admin to approve.</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {active.length === 0 ? (
          <p className="text-sm text-ink-muted">No devices yet.{canManage ? ' Add a phone, laptop or sensor placed next to the machine.' : ''}</p>
        ) : (
          <ul className="grid gap-1" aria-label="Active devices">
            {active.map((d) => {
              const seen = d.last_seen_at ? now - Date.parse(d.last_seen_at) : Infinity;
              const live = seen < ONLINE_MS;
              const learning = d.learned_at === null && d.latest?.learning;
              return (
                <li key={d.id} className="flex items-center gap-3 rounded-xl py-1.5">
                  <span aria-hidden className={`size-2 shrink-0 rounded-full ${live ? 'bg-normal' : 'bg-line-strong'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{d.name}</span>
                    <span className="block text-xs text-ink-faint">
                      {live ? 'listening now' : d.last_seen_at ? `last seen ${formatAgo(seen)}` : 'never connected'}
                      {learning ? ` · learning normal sound ${learning.windows}/${learning.needed}` : ''}
                    </span>
                  </span>
                  {canManage && (
                    <RowMenu
                      label={`More for ${d.name}`}
                      disabled={busy !== null}
                      actions={[
                        ...(d.learned_at ? [{ label: 'Re-learn normal sound', onClick: () => void act(`relearn:${d.id}`, () => httpClient!.account.relearnDevice(d.id)) }] : []),
                        { label: 'Remove device', danger: true, onClick: () => void act(`remove:${d.id}`, () => httpClient!.account.revokeDevice(d.id)) },
                      ]}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <FormError>{error}</FormError>
      </Panel>

      <Modal open={adding} title="Add a device" onClose={closeAdd}>
        {approvedName ? (
          <div className="grid justify-items-center gap-3 py-2 text-center">
            <p role="status" className="text-base font-semibold text-normal">{approvedName} is added</p>
            <p className="text-sm text-ink-muted">It starts listening now. During its first minute it learns the machine's normal sound.</p>
            <Button variant="primary" className="min-h-10 px-6" onClick={closeAdd}>
              Done
            </Button>
          </div>
        ) : joiner ? (
          <div className="grid gap-3 text-center">
            <p className="text-sm text-ink-muted">This device used the code and asks to join:</p>
            <p className="flex items-center justify-center gap-2 text-lg font-semibold">
              <Smartphone aria-hidden className="size-5 text-teal" />
              {joiner.name}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" className="min-h-11 flex-1" disabled={busy !== null} onClick={() => void reject(joiner).then(closeAdd)}>
                Reject
              </Button>
              <Button variant="primary" className="min-h-11 flex-1" disabled={busy !== null} onClick={() => void approve(joiner)}>
                Approve
              </Button>
            </div>
          </div>
        ) : code && left > 0 ? (
          <div className="grid justify-items-center gap-2 text-center">
            {qr && <img src={qr} alt={`QR code to pair ${code.device_name}`} className="size-48 rounded-xl border border-line bg-white" />}
            <p className="num text-3xl font-semibold tracking-[0.16em]" aria-label={`Pairing code ${code.code.split('').join(' ')}`}>
              {code.code}
            </p>
            <p className="text-sm text-ink-muted">
              Scan with the phone or sensor, or open <span className="font-semibold text-ink">{location.host}/pair</span> and type the code. When
              it asks to join, you approve it right here.
            </p>
            <p className="num text-xs text-ink-faint">
              Expires in {Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, '0')} · works once
            </p>
            <button type="button" onClick={() => void listenHere()} disabled={busy !== null} className="mt-1 text-sm font-semibold text-teal hover:underline">
              {busy === 'self' ? 'Pairing…' : 'Or listen with this browser'}
            </button>
          </div>
        ) : code ? (
          <div className="grid justify-items-center gap-3 text-center">
            <p className="text-sm text-ink-muted">This code expired.</p>
            <Button variant="primary" className="min-h-10 px-6" onClick={() => void add()}>
              New code
            </Button>
          </div>
        ) : (
          <p className="text-sm text-ink-faint">{busy === 'add' ? 'Creating a code…' : ''}</p>
        )}
        <FormError>{error}</FormError>
      </Modal>

      {/* Pop-up for a new device asking to join, wherever the admin is on the page */}
      {popup && (
        <div role="alertdialog" aria-label="New device wants to join" className="fixed right-4 bottom-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-4 shadow-2xl">
          <p className="eyebrow text-teal">New device wants to join</p>
          <p className="mt-1 flex items-center gap-2 font-semibold">
            <Smartphone aria-hidden className="size-4 text-teal" />
            {popup.name}
          </p>
          <p className="mt-0.5 text-xs text-ink-faint">Only approve a device you just gave the code to.</p>
          <div className="mt-3 flex gap-2">
            <Button variant="ghost" className="min-h-10 flex-1 px-3" disabled={busy !== null} onClick={() => void reject(popup)}>
              Reject
            </Button>
            <Button variant="primary" className="min-h-10 flex-1 px-3" disabled={busy !== null} onClick={() => void approve(popup)}>
              Approve
            </Button>
          </div>
          <button type="button" onClick={() => setDismissed((s) => new Set(s).add(popup.id))} className="mt-2 w-full text-center text-xs text-ink-faint hover:text-ink">
            Decide later (it stays in Devices)
          </button>
        </div>
      )}
    </div>
  );
}

function isLive(d: DeviceSummary, now: number) {
  return !!d.last_seen_at && now - Date.parse(d.last_seen_at) < ONLINE_MS;
}
