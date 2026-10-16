import { Mic, Play, Square, Waves } from 'lucide-react';
import { MOCK_SCENARIOS, type MockScenario } from '../../api/mockMonitoringClient';
import type { SourceKind } from '../../audio/sources';
import type { MachineProfile, MonitoringStatus } from '../../types/monitoring';
import { Button } from '../ui/primitives';

const selectCls =
  'min-h-11 w-full rounded-full border border-line-strong bg-surface pl-4 pr-9 text-sm font-medium text-ink disabled:opacity-60 appearance-none bg-[url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2016%2016%27%20fill=%27none%27%20stroke=%27%23545d6b%27%20stroke-width=%271.8%27%3E%3Cpath%20d=%27M4%206l4%204%204-4%27/%3E%3C/svg%3E")] bg-[length:16px] bg-[right_14px_center] bg-no-repeat';

export function ControlBar({
  profiles,
  machineId,
  onMachine,
  source,
  onSource,
  status,
  canStart,
  onStart,
  onStop,
  scenario,
  onScenario,
}: {
  profiles: MachineProfile[];
  machineId: string;
  onMachine: (id: string) => void;
  source: SourceKind;
  onSource: (s: SourceKind) => void;
  status: MonitoringStatus;
  canStart: boolean;
  onStart: () => void;
  onStop: () => void;
  scenario?: MockScenario;
  onScenario?: (s: MockScenario) => void;
}) {
  const running = status === 'monitoring' || status === 'interrupted';
  const busy = status === 'requesting_permission';
  const hint = MOCK_SCENARIOS.find((s) => s.id === scenario)?.hint;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <label className="grid gap-1.5">
          <span className="eyebrow text-ink-faint">Machine profile</span>
          <select
            className={selectCls}
            value={machineId}
            disabled={running || busy || profiles.length === 0}
            onChange={(e) => onMachine(e.target.value)}
          >
            {profiles.length === 0 && <option value="">No profiles loaded</option>}
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} · {p.id}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="grid gap-1.5" disabled={running || busy}>
          <legend className="eyebrow mb-1.5 text-ink-faint">Audio source</legend>
          <div className="grid grid-cols-2 rounded-full border border-line-strong bg-surface p-1">
            {([
              ['microphone', 'Microphone', Mic],
              ['simulated', 'Demo audio', Waves],
            ] as const).map(([id, label, Icon]) => (
              <label
                key={id}
                className={`flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full text-sm font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-teal ${
                  source === id ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'
                }`}
              >
                <input type="radio" name="source" value={id} checked={source === id} onChange={() => onSource(id)} className="sr-only" />
                <Icon aria-hidden className="size-4" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {scenario && onScenario && (
          <label className="grid gap-1.5 sm:col-span-2 xl:col-span-1">
            <span className="eyebrow text-teal">Simulation scenario</span>
            <select className={`${selectCls} border-dashed border-teal/60`} value={scenario} onChange={(e) => onScenario(e.target.value as MockScenario)}>
              {MOCK_SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <span className="truncate px-1 text-xs text-ink-faint">{hint}</span>
          </label>
        )}
      </div>

      <div className="flex gap-2">
        {running ? (
          <Button variant="danger" onClick={onStop} className="w-full px-7 lg:w-auto">
            <Square aria-hidden className="size-4 fill-current" />
            Stop monitoring
          </Button>
        ) : (
          <Button variant="primary" onClick={onStart} disabled={!canStart || busy} className="w-full px-7 lg:w-auto">
            <Play aria-hidden className="size-4 fill-current" />
            {busy ? 'Requesting access…' : 'Start monitoring'}
          </Button>
        )}
      </div>
    </div>
  );
}
