import { useCallback, useEffect, useState } from 'react';
import { client, role } from '../api';
import type { SourceKind } from '../audio/sources';
import { AlertList } from '../components/alerts/AlertList';
import { AlertToast } from '../components/alerts/AlertToast';
import { AnomalyTrendChart } from '../components/charts/AnomalyTrendChart';
import { SpectrogramChart } from '../components/charts/SpectrogramChart';
import { WaveformChart } from '../components/charts/WaveformChart';
import { AppHeader, type AccountMenu, type DrawerId } from '../components/layout/AppHeader';
import { AssessmentCard } from '../components/monitoring/AssessmentCard';
import { ControlBar } from '../components/monitoring/ControlBar';
import { ModelInfoPanel } from '../components/monitoring/ModelInfoPanel';
import { SettingsPanel } from '../components/monitoring/SettingsPanel';
import { SignalChain } from '../components/monitoring/SignalChain';
import { StatusBanner } from '../components/monitoring/StatusBanner';
import { WatchBar } from '../components/monitoring/WatchBar';
import { Drawer } from '../components/ui/Drawer';
import { DevicesSection } from '../components/workspace/DevicesSection';
import { ManagePanel } from '../components/workspace/ManagePanel';
import { Button, Panel, StatusChip } from '../components/ui/primitives';
import { useMonitoringSession } from '../hooks/useMonitoringSession';
import { useNow } from '../hooks/useNow';
import { useProjectWatch } from '../hooks/useProjectWatch';
import { playAlertTone } from '../lib/alertSound';
import { clearCredentials, credentials } from '../lib/credentials';
import { accessToken } from '../lib/supabase';
import { timeZoneLabel } from '../lib/format';
import { assessmentView } from '../lib/sessionReducer';
import { modeLabel } from '../lib/status';
import { signOut } from '../lib/session';

const DRAWER_TITLE: Record<DrawerId, string> = {
  alerts: 'Alert history',
  model: 'Model & system',
  settings: 'Settings',
  workspace: 'Workspace',
  devices: 'Add a device',
};

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', viewer: 'Viewer' } as const;
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function accountMenu(overviewName: string | undefined, overviewRole: keyof typeof ROLE_LABEL | undefined): AccountMenu | null {
  const name = credentials?.projectName ?? overviewName ?? 'Workspace';
  switch (role) {
    case 'member':
      return {
        title: name,
        subtitle: overviewRole ? ROLE_LABEL[overviewRole] : 'Member',
        actions: [
          { label: 'Switch workspace', onClick: () => location.assign('/workspaces?choose') },
          { label: 'Sign out', onClick: () => void signOut() },
        ],
      };
    case 'guest':
      return {
        title: 'Guest workspace',
        subtitle: credentials?.expiresAt ? `Deleted at ${clock(credentials.expiresAt)}` : 'Temporary',
        actions: [
          { label: 'Create an account', onClick: () => location.assign('/signin') },
          { label: 'Leave guest workspace', onClick: () => (clearCredentials(), location.assign('/signin')) },
        ],
      };
    case 'device':
      return {
        title: credentials?.deviceName ?? 'Listening device',
        subtitle: `Listening device · ${credentials?.projectName ?? 'workspace'}`,
        actions: [
          {
            label: 'Unpair this browser',
            onClick: () => {
              clearCredentials();
              void accessToken().then((t) => location.assign(t ? '/workspaces?choose' : '/signin'));
            },
          },
        ],
      };
    case 'viewer':
      return { title: name, subtitle: 'View-only link', actions: [{ label: 'Sign in', onClick: () => location.assign('/signin') }] };
    default:
      return null;
  }
}

export function Dashboard() {
  const session = useMonitoringSession();
  // Members, guests and viewer links watch remote listening devices instead of capturing locally.
  const watching = role === 'viewer' || role === 'member' || role === 'guest';
  const watch = useProjectWatch(watching);
  const vm = watching ? watch : session;
  const { state, events } = vm;
  const { backend } = session;
  const mode = modeLabel(backend.health?.mode);
  const now = useNow(500);
  const [drawer, setDrawer] = useState<DrawerId | null>(null);
  const [source, setSource] = useState<SourceKind>(client.mode === 'mock' ? 'simulated' : 'microphone');
  const [machineId, setMachineId] = useState('');
  const [micId, setMicId] = useState<string | null>(null);
  const [sound, setSound] = useState(false);
  const canManage = watching && (watch.overview?.role === 'owner' || watch.overview?.role === 'admin') && watch.overview?.access !== 'viewer_key';

  useEffect(() => {
    if (role === 'unconfigured') location.replace('/signin'); // live mode needs a workspace (or a paired device)
  }, []);

  const profiles = backend.config?.supported_profiles ?? [];
  const profile = profiles.find((p) => p.id === machineId) ?? profiles[0];

  const hopMs = backend.config?.input.hop_ms ?? 1000;
  const view = assessmentView(state, now, Math.max(3000, hopMs * 3));
  const activeEvent = events.find((e) => e.ended_at === null) ?? null;
  const running = state.status === 'monitoring' || state.status === 'interrupted';
  const capturing = running && !!state.source && state.error?.kind !== 'capture' && state.error?.kind !== 'permission';

  const start = useCallback(
    (kind: SourceKind = source) => {
      if (profile) void session.start(kind, profile.id, micId);
    },
    [micId, profile, session, source],
  );

  useEffect(() => {
    if (vm.newAlert && sound) playAlertTone();
  }, [vm.newAlert, sound]);

  return (
    <div className="min-h-dvh">
      <AppHeader
        openAlerts={events.filter((e) => e.ended_at === null).length}
        onOpen={setDrawer}
        canManage={canManage}
        account={accountMenu(watch.overview?.name, watch.overview?.role)}
      />

      {role === 'guest' && credentials?.expiresAt && (
        <div className="border-b border-warning/20 bg-warning-soft">
          <p className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm text-warning sm:px-6 lg:px-8">
            <span className="font-semibold">Guest workspace</span>
            <span>Nothing is kept: it and everything in it is deleted at {clock(credentials.expiresAt)}.</span>
            <a href="/signin" className="font-semibold underline underline-offset-4">
              Create an account to keep your work
            </a>
          </p>
        </div>
      )}

      <main className="mx-auto grid max-w-[1440px] gap-5 px-4 pt-6 pb-16 sm:px-6 lg:px-8 lg:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <p className="eyebrow text-ink-faint">
              Live monitoring ·{' '}
              <span className={mode.className}>{mode.text}</span>
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              {profile ? profile.label : 'Machine monitor'}
              {profile && <span className="ml-3 align-middle text-base font-medium tracking-normal text-ink-faint">{profile.id}</span>}
            </h1>
          </div>
          <p className="max-w-md text-sm text-ink-muted">
            Listens for acoustic patterns that differ from this machine's learned normal sound and raises a review alert
            when they persist.
          </p>
        </div>

        <Panel className="!p-4 sm:!p-5">
          {watching ? (
            <WatchBar
              overview={watch.overview}
              error={watch.overviewError}
              deviceId={watch.deviceId}
              onSelect={watch.selectDevice}
              now={now}
              onAddDevice={canManage ? () => setDrawer('devices') : undefined}
            />
          ) : role === 'unconfigured' ? (
            <div className="grid gap-1 text-sm">
              <p className="font-semibold">This console isn't linked to a project yet.</p>
              <p className="text-ink-muted">
                Open it with a device link (to listen) or a dashboard link (to watch). Both are printed by{' '}
                <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">python -m app.admin</code> on the backend.
              </p>
            </div>
          ) : (
          <ControlBar
            profiles={profiles}
            machineId={profile?.id ?? ''}
            onMachine={setMachineId}
            source={source}
            onSource={setSource}
            status={state.status}
            canStart={!!profile && !backend.loading}
            onStart={() => start()}
            onStop={session.stop}
            scenario={session.scenario}
            onScenario={session.setScenario}
          />
          )}
        </Panel>

        <StatusBanner
          state={state}
          backendError={backend.error}
          onRetryBackend={() => void session.reloadBackend()}
          onRetryStart={() => start()}
          onUseDemo={() => {
            setSource('simulated');
            if (session.scenario === 'mic_denied') session.setScenario('normal');
            start('simulated');
          }}
        />

        <SignalChain state={state} view={view} now={now} activeEvent={activeEvent} />

        <div className="grid gap-5 lg:grid-cols-12">
          <div className="lg:col-span-4 lg:col-start-9 lg:row-span-1 lg:row-start-1">
            <AssessmentCard view={view} state={state} config={backend.config} activeEvent={activeEvent} now={now} />
          </div>

          <Panel
            className="lg:col-span-8 lg:row-start-1"
            eyebrow="Audio input"
            title="Live signal"
            labelledBy="signal-title"
            actions={
              state.source?.kind === 'simulated' ? (
                <StatusChip tone="accent">Simulated audio</StatusChip>
              ) : state.source ? (
                <StatusChip tone={capturing ? 'accent' : 'neutral'}>{capturing ? state.source.label : 'Not capturing'}</StatusChip>
              ) : null
            }
          >
            {watching ? (
              <p className="rounded-[var(--radius-inner)] border border-dashed border-line-strong p-6 text-sm text-ink-muted">
                Audio is captured and analysed from the listening device. Only scores and alerts are sent to this screen, so
                there is no waveform here.
              </p>
            ) : (
            <div className="grid gap-6">
              <WaveformChart bufferRef={session.bufferRef} sampleRate={state.source?.sampleRate ?? null} running={capturing} />
              <SpectrogramChart bufferRef={session.bufferRef} sampleRate={state.source?.sampleRate ?? null} running={capturing} />
            </div>
            )}
            {!state.source && !watching && (
              <p className="mt-4 text-xs text-ink-faint">Waveform starts as soon as capture begins, before the first AI score.</p>
            )}
            {state.status === 'stopped' && (
              <p className="mt-4 text-xs text-ink-faint">Capture stopped. Audio buffers were discarded.</p>
            )}
          </Panel>

          <Panel
            className="min-w-0 lg:col-span-8"
            eyebrow="Model output"
            title="Anomaly score trend"
            labelledBy="trend-title"
            actions={state.status === 'stopped' ? <StatusChip tone="neutral">Historical: session stopped</StatusChip> : undefined}
          >
            <AnomalyTrendChart series={state.series} scoreName={backend.config?.score.name ?? 'score'} />
          </Panel>

          <Panel
            className="lg:col-span-4"
            eyebrow="This session"
            title="Recent alerts"
            labelledBy="alerts-title"
            actions={events.length > 2 ? <Button variant="ghost" className="min-h-9 px-3 text-xs" onClick={() => setDrawer('alerts')}>View all</Button> : undefined}
          >
            <AlertList events={events} profiles={profiles} now={now} onAcknowledge={vm.acknowledge} limit={2} compact />
          </Panel>
        </div>

        <footer className="flex flex-wrap justify-between gap-2 pt-2 text-xs text-ink-faint">
          <p>Experimental prototype. Not a certified safety or diagnostic system. Alerts call for human inspection.</p>
          <p>Times shown in {timeZoneLabel()}</p>
        </footer>
      </main>

      <AlertToast
        event={vm.newAlert}
        machineLabel={profile?.label ?? ''}
        onView={() => {
          vm.dismissNewAlert();
          setDrawer('alerts');
        }}
        onDismiss={vm.dismissNewAlert}
      />

      <Drawer open={drawer !== null} title={drawer ? DRAWER_TITLE[drawer] : ''} onClose={() => setDrawer(null)}>
        {drawer === 'alerts' && (
          <AlertList events={events} profiles={profiles} now={now} onAcknowledge={vm.acknowledge} />
        )}
        {drawer === 'model' && <ModelInfoPanel backend={backend} state={state} mode={client.mode} />}
        {drawer === 'settings' && (
          <SettingsPanel deviceId={micId} onDevice={setMicId} sound={sound} onSound={setSound} locked={running} />
        )}
        {drawer === 'workspace' && watch.overview && <ManagePanel overview={watch.overview} profiles={profiles} onChanged={watch.reload} />}
        {drawer === 'devices' && watch.overview && (
          <DevicesSection overview={watch.overview} profiles={profiles} onChanged={watch.reload} hideEmptyList />
        )}
      </Drawer>
    </div>
  );
}
