import { useCallback, useEffect, useRef, useState } from 'react';
import { accounts, client, httpClient, role } from '../api';
import type { SourceKind } from '../audio/sources';
import { AlertList } from '../components/alerts/AlertList';
import { AlertToast } from '../components/alerts/AlertToast';
import { AnomalyTrendChart } from '../components/charts/AnomalyTrendChart';
import { SpectrogramChart } from '../components/charts/SpectrogramChart';
import { WaveformChart } from '../components/charts/WaveformChart';
import { Sidebar, type AccountBlock } from '../components/layout/Sidebar';
import { AssessmentCard } from '../components/monitoring/AssessmentCard';
import { ControlBar } from '../components/monitoring/ControlBar';
import { SettingsPanel } from '../components/monitoring/SettingsPanel';
import { SignalChain } from '../components/monitoring/SignalChain';
import { StatusBanner } from '../components/monitoring/StatusBanner';
import { WatchBar } from '../components/monitoring/WatchBar';
import { Drawer } from '../components/ui/Drawer';
import { DevicesCard } from '../components/workspace/DevicesCard';
import { MembersCard } from '../components/workspace/MembersCard';
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
import { open, signOut } from '../lib/session';
import type { Me } from '../types/monitoring';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', viewer: 'Viewer' } as const;
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const countdown = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function accountBlock(me: Me | null, emailAlerts: boolean | undefined, toggleEmail: () => void, openSettings: () => void,
  overviewRole: keyof typeof ROLE_LABEL | undefined, now: number): AccountBlock | null {
  const settings = { label: 'Microphone & sound', onClick: openSettings };
  switch (role) {
    case 'member':
      return {
        title: me?.user.email ?? 'Signed in',
        subtitle: overviewRole ? `${ROLE_LABEL[overviewRole]} · alert e-mails ${emailAlerts === false ? 'off' : 'on'}` : 'Member',
        actions: [
          { label: emailAlerts === false ? 'Turn alert e-mails on' : 'Turn alert e-mails off', onClick: toggleEmail },
          settings,
          { label: 'Sign out', onClick: () => void signOut() },
        ],
      };
    case 'guest':
      return {
        title: 'Guest',
        subtitle: credentials?.expiresAt ? `Deleted in ${countdown(Date.parse(credentials.expiresAt) - now)}` : 'Temporary',
        actions: [
          { label: 'Create an account', onClick: () => location.assign('/signin') },
          settings,
          { label: 'Leave guest workspace', onClick: () => (clearCredentials(), location.assign('/signin')) },
        ],
      };
    case 'device':
      return {
        title: credentials?.deviceName ?? 'Listening device',
        subtitle: 'This browser listens',
        actions: [
          settings,
          {
            label: 'Unpair this browser',
            onClick: () => {
              clearCredentials();
              void accessToken().then((t) => location.assign(t ? '/workspaces' : '/signin'));
            },
          },
        ],
      };
    case 'viewer':
      return { title: 'View-only link', subtitle: 'Watching', actions: [settings, { label: 'Sign in', onClick: () => location.assign('/signin') }] };
    default:
      return { title: 'Demo', subtitle: 'Simulated backend', actions: [settings] };
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [allAlerts, setAllAlerts] = useState(false);
  const alertsRef = useRef<HTMLDivElement>(null);
  const [addSignal, setAddSignal] = useState(0);
  const [me, setMe] = useState<Me | null>(null);
  const [source, setSource] = useState<SourceKind>(client.mode === 'mock' ? 'simulated' : 'microphone');
  const [machineId, setMachineId] = useState('');
  const [micId, setMicId] = useState<string | null>(null);
  const [sound, setSound] = useState(false);
  const canManage = watching && (watch.overview?.role === 'owner' || watch.overview?.role === 'admin') && watch.overview?.access !== 'viewer_key';

  useEffect(() => {
    if (role === 'unconfigured') location.replace('/signin'); // live mode needs a workspace (or a paired device)
  }, []);

  // Signed in: my workspaces for the sidebar, with their live status (refreshed now and then).
  const loadMe = useCallback(() => {
    if (role === 'member') accounts.me().then(setMe, () => undefined);
  }, []);
  useEffect(() => {
    loadMe();
    const t = setInterval(loadMe, 20_000);
    return () => clearInterval(t);
  }, [loadMe]);
  const emailAlerts = me?.workspaces.find((w) => w.id === credentials?.projectId)?.email_alerts;
  const toggleEmail = () => void httpClient?.account.setEmailAlerts(emailAlerts === false).then(loadMe);

  const guestGone = role === 'guest' && !!credentials?.expiresAt && Date.parse(credentials.expiresAt) <= now;
  useEffect(() => {
    if (!guestGone) return;
    clearCredentials(); // the guest workspace has been deleted
    location.replace('/signin');
  }, [guestGone]);

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
    <div className="min-h-dvh lg:pl-64">
      <Sidebar
        workspaces={role === 'member' ? (me?.workspaces ?? null) : null}
        currentId={credentials?.projectId ?? (role === 'mock' ? 'demo' : null)}
        currentName={credentials?.projectName ?? watch.overview?.name ?? (role === 'mock' ? 'Demo workspace' : 'Workspace')}
        onOpen={(w) => open(w)}
        onCreate={role === 'member' ? async (name) => open(await accounts.createWorkspace(name)) : undefined}
        account={accountBlock(me, emailAlerts, toggleEmail, () => setSettingsOpen(true), watch.overview?.role, now)}
      />

      {role === 'guest' && credentials?.expiresAt && (
        <div className="border-b border-warning/20 bg-warning-soft">
          <p className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm text-warning sm:px-6 lg:px-8">
            <span className="font-semibold">Guest workspace</span>
            <span>
              Nothing is kept: it and everything in it is deleted in{' '}
              <span data-testid="guest-countdown" className="num font-semibold tabular-nums">
                {countdown(Date.parse(credentials.expiresAt) - now)}
              </span>{' '}
              (at {clock(credentials.expiresAt)}).
            </span>
            <a href="/signin" className="font-semibold underline underline-offset-4">
              Create an account to keep your work
            </a>
          </p>
        </div>
      )}

      <main className="mx-auto grid max-w-[1280px] gap-5 px-4 pt-6 pb-16 sm:px-6 lg:px-8 lg:pt-8">
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
              onAddDevice={canManage ? () => setAddSignal((n) => n + 1) : undefined}
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

        <div className="grid items-start gap-5 lg:grid-cols-12">
          {/* Left: the signal and its score */}
          <div className="grid min-w-0 gap-5 lg:col-span-8">
            <Panel
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
              {state.status === 'stopped' && <p className="mt-4 text-xs text-ink-faint">Capture stopped. Audio buffers were discarded.</p>}
            </Panel>

            <Panel
              className="min-w-0"
              eyebrow="Model output"
              title="Anomaly score trend"
              labelledBy="trend-title"
              actions={state.status === 'stopped' ? <StatusChip tone="neutral">Historical: session stopped</StatusChip> : undefined}
            >
              <AnomalyTrendChart series={state.series} scoreName={backend.config?.score.name ?? 'score'} />
            </Panel>
          </div>

          {/* Right: status, alerts, and the workspace's devices and members */}
          <div className="grid min-w-0 gap-5 lg:col-span-4">
            <AssessmentCard view={view} state={state} config={backend.config} activeEvent={activeEvent} now={now} />

            <div ref={alertsRef}>
              <Panel
                title="Alerts"
                labelledBy="alerts-title"
                actions={
                  events.length > 2 ? (
                    <Button variant="ghost" className="min-h-9 px-3 text-xs" onClick={() => setAllAlerts((a) => !a)}>
                      {allAlerts ? 'Show fewer' : `Show all ${events.length}`}
                    </Button>
                  ) : undefined
                }
              >
                <AlertList events={events} profiles={profiles} now={now} onAcknowledge={vm.acknowledge} limit={allAlerts ? undefined : 2} compact />
              </Panel>
            </div>

            {watching && watch.overview && (
              <DevicesCard overview={watch.overview} profiles={profiles} canManage={canManage} addSignal={addSignal} onChanged={watch.reload} />
            )}
            {(role === 'member' || role === 'guest') && watch.overview?.role && (
              <MembersCard myRole={watch.overview.role} isGuest={role === 'guest'} />
            )}
          </div>
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
          setAllAlerts(true);
          alertsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }}
        onDismiss={vm.dismissNewAlert}
      />

      <Drawer open={settingsOpen} title="Microphone & sound" onClose={() => setSettingsOpen(false)}>
        <SettingsPanel deviceId={micId} onDevice={setMicId} sound={sound} onSound={setSound} locked={running} />
      </Drawer>
    </div>
  );
}
