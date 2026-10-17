import { useState } from 'react';
import type { MachineProfile, ProjectOverview } from '../../types/monitoring';
import { ActivitySection } from './ActivitySection';
import { AlertsSection } from './AlertsSection';
import { DevicesSection } from './DevicesSection';
import { TeamSection } from './TeamSection';

export type ManageTab = 'devices' | 'team' | 'alerts' | 'activity';

const TABS: { id: ManageTab; label: string }[] = [
  { id: 'devices', label: 'Devices' },
  { id: 'team', label: 'Team' },
  { id: 'alerts', label: 'E-mail alerts' },
  { id: 'activity', label: 'Activity' },
];

/** Workspace administration for owners and admins (and the guest, who owns a temporary workspace). */
export function ManagePanel({
  overview,
  profiles,
  initialTab = 'devices',
  onChanged,
}: {
  overview: ProjectOverview;
  profiles: MachineProfile[];
  initialTab?: ManageTab;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<ManageTab>(initialTab);
  const guest = !!overview.is_guest;

  return (
    <div className="grid gap-5">
      <div role="tablist" aria-label="Workspace settings" className="-mx-1 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex min-h-9 shrink-0 items-center rounded-full px-3.5 text-sm font-medium whitespace-nowrap ${
              tab === t.id ? 'bg-ink text-white' : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'devices' && <DevicesSection overview={overview} profiles={profiles} onChanged={onChanged} />}
      {tab === 'team' &&
        (guest ? (
          <p className="rounded-[var(--radius-inner)] border border-dashed border-line-strong p-5 text-sm text-ink-muted">
            Guest workspaces are private to this browser. <a href="/signin" className="font-semibold text-teal hover:underline">Create an account</a> to
            invite your team.
          </p>
        ) : (
          <TeamSection myRole={overview.role ?? 'viewer'} />
        ))}
      {tab === 'alerts' && <AlertsSection />}
      {tab === 'activity' && <ActivitySection />}
    </div>
  );
}

export function SectionNote({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-ink-faint">{children}</p>;
}
