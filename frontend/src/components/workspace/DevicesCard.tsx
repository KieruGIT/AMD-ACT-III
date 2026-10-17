import { Plus } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { accounts, httpClient } from '../../api';
import { saveCredentials } from '../../lib/credentials';
import { formatAgo } from '../../lib/format';
import type { MachineProfile, PairingCode, ProjectOverview } from '../../types/monitoring';
import { FormError, go } from '../auth/AuthShell';
import { Button, Panel } from '../ui/primitives';
import { RowMenu } from '../ui/RowMenu';

const ONLINE_MS = 10_000;

/**
 * The workspace's listening devices, and the one place to add or remove them. "+ Add" shows a pairing code and QR
 * straight away (one click); the phone or sensor scans it or enters the code at /pair.
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
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef<HTMLDivElement>(null);
  const machine = profiles[0]?.id ?? 'fan_01';

  const left = code ? Date.parse(code.expires_at) - now : 0;
  const paired = code && overview.devices.some((d) => d.name === code.device_name);

  useEffect(() => {
    if (!code) return;
    void QRCode.toDataURL(`${location.origin}/pair#code=${code.code}`, { margin: 1, width: 400, color: { dark: '#111e3b', light: '#ffffff' } }).then(setQr);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
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

  // A fresh name each time, so several devices stay distinguishable in the list.
  const nextName = () => {
    const taken = new Set(overview.devices.map((d) => d.name));
    let n = overview.devices.length + 1;
    while (taken.has(`Device ${n}`)) n++;
    return `Device ${n}`;
  };

  const add = () =>
    run('add', async () => {
      setQr(null);
      setCode(await httpClient!.account.pairingCode(nextName(), machine));
      setNow(Date.now());
    });

  const listenHere = () =>
    run('self', async () => {
      const c = code ?? (await httpClient!.account.pairingCode('This browser', machine));
      const d = await accounts.pair(c.code);
      saveCredentials({ projectId: d.project_id, projectName: d.project_name, deviceKey: d.device_key, deviceName: d.device_name });
      go('/app');
    });

  const remove = (id: string) =>
    run(`remove:${id}`, async () => {
      await httpClient!.account.revokeDevice(id);
      onChanged();
    });

  // The monitor's "Add a device" button lands here with a code already showing.
  useEffect(() => {
    if (!addSignal || !canManage) return;
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    void add();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per click
  }, [addSignal]);

  return (
    <div ref={ref}>
      <Panel
        title="Devices"
        labelledBy="devices-title"
        actions={
          canManage && !(code && left > 0 && !paired) ? (
            <Button variant="ghost" className="min-h-9 gap-1 px-3 text-xs" disabled={busy !== null} onClick={() => void add()}>
              <Plus aria-hidden className="size-3.5" />
              {busy === 'add' ? 'Creating…' : 'Add'}
            </Button>
          ) : undefined
        }
      >
        {code && left > 0 && (
          <div className="mb-4 grid justify-items-center gap-2 rounded-2xl bg-surface-muted p-4 text-center">
            {paired ? (
              <p role="status" className="text-sm font-semibold text-normal">
                {code.device_name} is paired.
              </p>
            ) : (
              <>
                {qr && <img src={qr} alt={`QR code to pair ${code.device_name}`} className="size-40 rounded-xl border border-line bg-white" />}
                <p className="num text-2xl font-semibold tracking-[0.16em]" aria-label={`Pairing code ${code.code.split('').join(' ')}`}>
                  {code.code}
                </p>
                <p className="text-xs text-ink-muted">
                  Scan on the phone or sensor, or open <span className="font-semibold text-ink">{location.host}/pair</span> and type the code.
                </p>
                <p className="num text-[11px] text-ink-faint">
                  Expires in {Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, '0')} · works once
                </p>
                <button type="button" onClick={() => void listenHere()} disabled={busy !== null} className="text-xs font-semibold text-teal hover:underline">
                  {busy === 'self' ? 'Pairing…' : 'Or listen with this browser'}
                </button>
              </>
            )}
            <button type="button" onClick={() => setCode(null)} className="text-xs text-ink-faint hover:text-ink">
              {paired ? 'Done' : 'Cancel'}
            </button>
          </div>
        )}

        {overview.devices.length === 0 ? (
          <p className="text-sm text-ink-muted">No devices yet.{canManage ? ' Add a phone, laptop or sensor placed next to the machine.' : ''}</p>
        ) : (
          <ul className="grid gap-1">
            {overview.devices.map((d) => {
              const seen = d.last_seen_at ? now - Date.parse(d.last_seen_at) : Infinity;
              const live = seen < ONLINE_MS;
              return (
                <li key={d.id} className="flex items-center gap-3 rounded-xl py-1.5">
                  <span aria-hidden className={`size-2 shrink-0 rounded-full ${live ? 'bg-normal' : 'bg-line-strong'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{d.name}</span>
                    <span className="block text-xs text-ink-faint">
                      {live ? 'listening now' : d.last_seen_at ? `last seen ${formatAgo(seen)}` : 'never connected'}
                    </span>
                  </span>
                  {canManage && (
                    <RowMenu
                      label={`More for ${d.name}`}
                      disabled={busy !== null}
                      actions={[{ label: 'Remove device', danger: true, onClick: () => void remove(d.id) }]}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <FormError>{error}</FormError>
      </Panel>
    </div>
  );
}
