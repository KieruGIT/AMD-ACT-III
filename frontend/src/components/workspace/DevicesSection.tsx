import { MonitorSmartphone } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { accounts, httpClient } from '../../api';
import { saveCredentials } from '../../lib/credentials';
import { formatAgo } from '../../lib/format';
import type { MachineProfile, PairingCode, ProjectOverview } from '../../types/monitoring';
import { FormError, go } from '../auth/AuthShell';
import { Button } from '../ui/primitives';
import { SectionNote } from './ManagePanel';

const ONLINE_MS = 10_000;

export function DevicesSection({
  overview,
  profiles,
  onChanged,
  hideEmptyList = false,
}: {
  overview: ProjectOverview;
  profiles: MachineProfile[];
  onChanged: () => void;
  hideEmptyList?: boolean; // the "Add a device" panel shows only the pairing form until a device exists
}) {
  const [name, setName] = useState('Phone at fan');
  const [machine, setMachine] = useState(profiles[0]?.id ?? 'fan_01');
  const [code, setCode] = useState<PairingCode | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const pairUrl = code ? `${location.origin}/pair#code=${code.code}` : '';
  const left = code ? Date.parse(code.expires_at) - now : 0;

  useEffect(() => {
    if (!code) return;
    void QRCode.toDataURL(pairUrl, { margin: 1, width: 440, color: { dark: '#111e3b', light: '#ffffff' } }).then(setQr);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [code, pairUrl]);

  // A new device appearing in the overview means the code was used.
  const paired = code && overview.devices.some((d) => d.name === code.device_name && Date.parse(d.created_at ?? '') > Date.parse(code.expires_at) - 600_000);

  async function run<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(what);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const create = () =>
    run('code', async () => {
      setCode(await httpClient!.account.pairingCode(name.trim(), machine));
      setNow(Date.now());
    });

  const pairThisBrowser = () =>
    run('self', async () => {
      const c = await httpClient!.account.pairingCode(name.trim() || 'This browser', machine);
      const d = await accounts.pair(c.code);
      saveCredentials({ projectId: d.project_id, projectName: d.project_name, deviceKey: d.device_key, deviceName: d.device_name });
      go('/app');
    });

  const revoke = (id: string) =>
    run(`revoke:${id}`, async () => {
      await httpClient!.account.revokeDevice(id);
      setConfirm(null);
      onChanged();
    });

  return (
    <div className="grid gap-6">
      {!(hideEmptyList && overview.devices.length === 0) && (
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold">Listening devices</h3>
        {overview.devices.length === 0 ? (
          <p className="text-sm text-ink-muted">None yet. Add a phone, laptop or sensor below.</p>
        ) : (
          <ul className="grid gap-2">
            {overview.devices.map((d) => {
              const seen = d.last_seen_at ? now - Date.parse(d.last_seen_at) : Infinity;
              return (
                <li key={d.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
                  <MonitorSmartphone aria-hidden className="size-5 shrink-0 text-ink-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{d.name}</span>
                    <span className="block text-xs text-ink-faint">
                      {d.machine_id} · {seen < ONLINE_MS ? 'listening now' : d.last_seen_at ? `last seen ${formatAgo(seen)}` : 'never connected'}
                    </span>
                  </span>
                  {confirm === d.id ? (
                    <span className="flex gap-1">
                      <Button variant="danger" className="min-h-9 px-3 text-xs" disabled={busy !== null} onClick={() => void revoke(d.id)}>
                        Revoke
                      </Button>
                      <Button variant="ghost" className="min-h-9 px-3 text-xs" onClick={() => setConfirm(null)}>
                        Keep
                      </Button>
                    </span>
                  ) : (
                    <Button variant="ghost" className="min-h-9 px-3 text-xs" onClick={() => setConfirm(d.id)}>
                      Remove
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <SectionNote>Removing a device revokes its key immediately. It stops being able to send audio.</SectionNote>
      </section>
      )}

      <section className="grid gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h3 className="text-sm font-semibold">Add a device</h3>
        {code && left > 0 ? (
          <div className="grid justify-items-center gap-3 text-center">
            {paired ? (
              <p role="status" className="rounded-xl bg-normal-soft px-3 py-2 text-sm text-normal">
                {code.device_name} is paired. It appears in the list above.
              </p>
            ) : (
              <>
                {qr && <img src={qr} alt={`QR code to pair ${code.device_name}`} className="size-52 rounded-xl border border-line" />}
                <p className="num text-3xl font-semibold tracking-[0.18em]" aria-label={`Pairing code ${code.code.split('').join(' ')}`}>
                  {code.code}
                </p>
                <p className="text-sm text-ink-muted">
                  On the device, scan the QR code, or open <span className="font-semibold text-ink">{location.host}/pair</span> and enter
                  the code.
                </p>
                <p className="num text-xs text-ink-faint">
                  Expires in {Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, '0')} · works once
                </p>
              </>
            )}
            <Button variant="ghost" className="min-h-9 px-3 text-xs" onClick={() => setCode(null)}>
              {paired ? 'Add another device' : 'Cancel'}
            </Button>
          </div>
        ) : (
          <>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-ink-muted">Device name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                className="min-h-11 rounded-xl border border-line-strong bg-surface px-3 text-sm"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-ink-muted">Machine it listens to</span>
              <select value={machine} onChange={(e) => setMachine(e.target.value)} className="min-h-11 rounded-xl border border-line-strong bg-surface px-3 text-sm">
                {(profiles.length ? profiles : [{ id: 'fan_01', label: 'Fan' }]).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.id})
                  </option>
                ))}
              </select>
            </label>
            <FormError>{error}</FormError>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy !== null || !name.trim()} onClick={() => void create()}>
                {busy === 'code' ? 'Creating code…' : 'Get pairing code'}
              </Button>
              <Button disabled={busy !== null} onClick={() => void pairThisBrowser()}>
                {busy === 'self' ? 'Pairing…' : 'Use this browser'}
              </Button>
            </div>
            <SectionNote>
              A device is anything with a microphone running this app: a phone, a laptop, or a small computer (e.g. a Raspberry Pi with a USB
              microphone) next to the machine. "Use this browser" turns this screen into the listener; sign out to return to the workspace.
            </SectionNote>
          </>
        )}
      </section>
    </div>
  );
}
