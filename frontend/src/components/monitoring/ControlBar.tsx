import { Mic, Play, Square, Waves } from 'lucide-react';
import type { ReactNode } from 'react';
import { MOCK_SCENARIOS, type MockScenario } from '../../api/mockMonitoringClient';
import type { SourceKind } from '../../audio/sources';
import type { MachineProfile, MonitoringStatus } from '../../types/monitoring';
import { Button } from '../ui/primitives';

const selectCls =
  'h-11 w-full appearance-none rounded-full border border-line-strong bg-surface pr-10 pl-4 text-sm font-medium text-ink disabled:opacity-60 bg-[url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2016%2016%27%20fill=%27none%27%20stroke=%27%23545d6b%27%20stroke-width=%271.8%27%3E%3Cpath%20d=%27M4%206l4%204%204-4%27/%3E%3C/svg%3E")] bg-[length:16px] bg-[right_14px_center] bg-no-repeat';

/** Every field is the same two rows (label + hint, then a 44px control) so controls line up across columns. */
function Field({ id, label, hint, accent, group, className = '', children }: {
  id: string; label: string; hint?: string; accent?: boolean; group?: boolean; className?: string; children: ReactNode;
}) {
  const Tag = group ? 'span' : 'label'; // a radiogroup is named by aria-labelledby, not <label for>
  return (
    <div className={`grid min-w-0 gap-2 ${className}`}>
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <Tag id={`${id}-label`} htmlFor={group ? undefined : id} className={`eyebrow shrink-0 ${accent ? 'text-teal' : 'text-ink-faint'}`}>
          {label}
        </Tag>
        {hint && <span className="truncate text-xs text-ink-faint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

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
  const locked = running || busy;
  const hint = MOCK_SCENARIOS.find((s) => s.id === scenario)?.hint;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Field id="machine" label="Machine profile">
          <select id="machine" className={selectCls} value={machineId} disabled={locked || profiles.length === 0} onChange={(e) => onMachine(e.target.value)}>
            {profiles.length === 0 && <option value="">No profiles loaded</option>}
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        <Field id="source" label="Audio source" group>
          <div role="radiogroup" id="source" aria-labelledby="source-label" className={`grid h-11 grid-cols-2 rounded-full border border-line-strong bg-surface p-1 ${locked ? 'opacity-60' : ''}`}>
            {([
              ['microphone', 'Microphone', Mic],
              ['simulated', 'Demo audio', Waves],
            ] as const).map(([id, label, Icon]) => (
              <label
                key={id}
                className={`flex items-center justify-center gap-1.5 rounded-full text-sm font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-teal ${
                  locked ? 'cursor-not-allowed' : 'cursor-pointer'
                } ${source === id ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'}`}
              >
                <input type="radio" name="source" value={id} checked={source === id} disabled={locked} onChange={() => onSource(id)} className="sr-only" />
                <Icon aria-hidden className="size-4" />
                {label}
              </label>
            ))}
          </div>
        </Field>

        {scenario && onScenario && (
          <Field id="scenario" label="Simulation scenario" hint={hint} accent className="sm:col-span-2 xl:col-span-1">
            <select id="scenario" className={`${selectCls} border-dashed border-teal/60`} value={scenario} onChange={(e) => onScenario(e.target.value as MockScenario)}>
              {MOCK_SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {running ? (
        <Button variant="danger" onClick={onStop} className="h-11 w-full px-7 lg:w-auto">
          <Square aria-hidden className="size-4 fill-current" />
          Stop monitoring
        </Button>
      ) : (
        <Button variant="primary" onClick={onStart} disabled={!canStart || busy} className="h-11 w-full px-7 lg:w-auto">
          <Play aria-hidden className="size-4 fill-current" />
          {busy ? 'Requesting access…' : 'Start monitoring'}
        </Button>
      )}
    </div>
  );
}
