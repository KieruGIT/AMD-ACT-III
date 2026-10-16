import { useEffect, useState } from 'react';

export function SettingsPanel({
  deviceId,
  onDevice,
  sound,
  onSound,
  locked,
}: {
  deviceId: string | null;
  onDevice: (id: string | null) => void;
  sound: boolean;
  onSound: (on: boolean) => void;
  locked: boolean;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    const load = () =>
      navigator.mediaDevices
        ?.enumerateDevices()
        .then((d) => setDevices(d.filter((x) => x.kind === 'audioinput')))
        .catch(() => setDevices([]));
    void load();
    navigator.mediaDevices?.addEventListener('devicechange', load);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', load);
  }, []);

  const unlabeled = devices.length > 0 && devices.every((d) => !d.label);

  return (
    <div className="grid gap-6">
      <label className="grid gap-1.5">
        <span className="text-sm font-semibold">Microphone input</span>
        <select
          className="min-h-11 rounded-xl border border-line-strong bg-surface px-3 text-sm disabled:opacity-60"
          value={deviceId ?? ''}
          disabled={locked}
          onChange={(e) => onDevice(e.target.value || null)}
        >
          <option value="">System default</option>
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `Microphone ${i + 1}`}
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-faint">
          {locked ? 'Stop monitoring to change the input.' : unlabeled ? 'Device names appear after microphone permission is granted.' : 'Echo cancellation, noise suppression and auto gain are requested off.'}
        </span>
      </label>

      <label className="flex items-start justify-between gap-4">
        <span>
          <span className="block text-sm font-semibold">Alert sound</span>
          <span className="block text-xs text-ink-faint">Short tone once per new sustained alert. Off by default.</span>
        </span>
        <input type="checkbox" checked={sound} onChange={(e) => onSound(e.target.checked)} className="mt-1 size-5 accent-teal" />
      </label>

      <div>
        <p className="text-sm font-semibold">Audio retention</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-faint">
          Off. Audio is held in memory only to build analysis windows and is discarded when monitoring stops. Alert history keeps
          timestamps and scores, not recordings. Evidence retention is not available in this prototype.
        </p>
      </div>

      <div>
        <p className="text-sm font-semibold">Monitoring availability</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-faint">
          Browser monitoring runs only while this tab is open and visible. Locked phones, hidden tabs and closed browsers stop it.
          Sustained capture would need a dedicated edge device.
        </p>
      </div>
    </div>
  );
}
