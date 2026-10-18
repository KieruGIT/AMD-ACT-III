import { Bell, Plus, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { accounts, client, httpClient, isDemo, role } from '../api';
import type { SourceKind } from '../audio/sources';
import { AlertList } from '../components/alerts/AlertList';
import { AlertToast } from '../components/alerts/AlertToast';
import { AnomalyTrendChart } from '../components/charts/AnomalyTrendChart';
import { SpectrogramChart } from '../components/charts/SpectrogramChart';
import { WaveformChart } from '../components/charts/WaveformChart';
import { Sidebar, type AccountBlock, type TreeDevice } from '../components/layout/Sidebar';
import { Modal } from '../components/ui/Modal';
import type { RowAction } from '../components/ui/RowMenu';
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
import { clearCredentials, credentials, saveCredentials } from '../lib/credentials';
import { accessToken } from '../lib/supabase';
import { formatAgo, timeZoneLabel } from '../lib/format';
import { assessmentView } from '../lib/sessionReducer';
import { open, signOut } from '../lib/session';
import type { Me } from '../types/monitoring';

/** A browser that listens for its own workspace goes back to managing it (its earlier access was kept). */
function goHome(add?: 'device' | 'member') {
  if (credentials?.home) saveCredentials(credentials.home);
  location.assign(add ? `/app?add=${add}` : '/app');
}

const SEEN_KEY = 'msm:seen-alerts';

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
              if (credentials?.home) return goHome();
              clearCredentials();
              void accessToken().then((t) => location.assign(t ? '/workspaces' : '/signin'));
            },
          },
        ],
      };
    case 'viewer':
      return { title: 'View-only link', subtitle: 'Watching', actions: [settings, { label: 'Sign in', onClick: () => location.assign('/signin') }] };
    default:
      return { title: 'Demo', subtitle: 'Simulated audio · nothing is sent', actions: [settings, { label: 'Sign in', onClick: () => location.assign('/signin') }] };
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
  const now = useNow(500);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [editing, setEditing] = useState(false); // rename / delete the workspace
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [addSignal, setAddSignal] = useState(0);
  const [memberSignal, setMemberSignal] = useState(0);
  // arriving with ?add=device|member (from a listening browser's buttons) opens that pop-up once the workspace loads
  const [pendingAdd] = useState(() => new URLSearchParams(location.search).get('add'));
  const [me, setMe] = useState<Me | null>(null);
  const [source, setSource] = useState<SourceKind>(client.mode === 'mock' ? 'simulated' : 'microphone');
  const [machineId, setMachineId] = useState('');
  const [micId, setMicId] = useState<string | null>(null);
  const [sound, setSound] = useState(false);
  const canManage = watching && (watch.overview?.role === 'owner' || watch.overview?.role === 'admin') && watch.overview?.access !== 'viewer_key';
  const isOwner = canManage && watch.overview?.role === 'owner';

  // Red dot per device: an alert that started after you last opened that device (remembered in this browser).
  const [seen, setSeen] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, string>;
    } catch {
      return {};
    }
  });
  const markSeen = useCallback((ids: string[]) => {
    setSeen((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = new Date().toISOString();
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(next));
      } catch {
        // private mode: dots reset on reload
      }
      return next;
    });
  }, []);
  const deviceIds = (watch.overview?.devices ?? []).map((d) => d.id).join(',');
  useEffect(() => {
    // a device seen here for the first time starts with no old alerts flagged
    const fresh = deviceIds.split(',').filter((id) => id && !seen[id]);
    if (fresh.length) markSeen(fresh);
  }, [deviceIds, seen, markSeen]);
  useEffect(() => {
    if (watch.deviceId) markSeen([watch.deviceId]);
  }, [watch.deviceId, markSeen]);

  const treeDevices: TreeDevice[] = (watch.overview?.devices ?? []).map((d) => {
    const ago = d.last_seen_at ? now - Date.parse(d.last_seen_at) : Infinity;
    const live = ago < 10_000;
    const learning = !d.pending && d.learned_at === null ? d.latest?.learning : null;
    return {
      id: d.id,
      name: d.name,
      live,
      pending: !!d.pending,
      unseen: (watch.overview?.events ?? []).some((e) => e.device_id === d.id && e.started_at > (seen[d.id] ?? '9999')),
      detail: d.pending
        ? 'wants to join'
        : learning
          ? `learning normal sound ${learning.windows}/${learning.needed}`
          : live
            ? 'listening now'
            : d.last_seen_at
              ? `last seen ${formatAgo(ago)}`
              : 'never connected',
    };
  });
  const deviceAction = (fn: () => Promise<unknown>) => () => void fn().then(watch.reload, () => watch.reload());
  const deviceActions = (d: TreeDevice): RowAction[] => {
    if (!canManage || !httpClient) return [];
    const api = httpClient.account;
    if (d.pending) {
      return [
        { label: 'Approve', onClick: deviceAction(() => api.approveDevice(d.id)) },
        { label: 'Reject', danger: true, onClick: deviceAction(() => api.revokeDevice(d.id)) },
      ];
    }
    const learned = watch.overview?.devices.find((x) => x.id === d.id)?.learned_at;
    return [
      ...(learned ? [{ label: 'Re-learn normal sound', onClick: deviceAction(() => api.relearnDevice(d.id)) }] : []),
      { label: 'Remove device', danger: true, onClick: deviceAction(() => api.revokeDevice(d.id)) },
    ];
  };
  const watchedName = watch.overview?.devices.find((d) => d.id === watch.deviceId)?.name;
  const hasActiveDevices = (watch.overview?.devices ?? []).some((d) => !d.pending);

  const openAlerts = () => {
    setAlertsOpen(true);
    if (watch.deviceId) markSeen([watch.deviceId]);
  };

  async function renameWorkspace(e: React.FormEvent) {
    e.preventDefault();
    setEditError(null);
    try {
      const r = await httpClient!.account.renameWorkspace(editName.trim());
      if (credentials) saveCredentials({ ...credentials, projectName: r.name });
      location.reload();
    } catch (err) {
      setEditError((err as Error).message);
    }
  }
  async function deleteWorkspace() {
    setEditError(null);
    try {
      await httpClient!.account.deleteWorkspace();
      clearCredentials();
      location.assign(role === 'guest' ? '/signin' : '/workspaces');
    } catch (err) {
      setEditError((err as Error).message);
    }
  }

  useEffect(() => {
    if (!pendingAdd || !canManage) return;
    history.replaceState(null, '', location.pathname);
    if (pendingAdd === 'device') setAddSignal((n) => n + 1);
    if (pendingAdd === 'member') setMemberSignal((n) => n + 1);
  }, [pendingAdd, canManage]);

  useEffect(() => {
    if (role === 'unconfigured') location.replace('/signin'); // live mode needs a workspace (or a paired device)
  }, []);

  // Signed in: my workspaces for the sidebar, with their live status (refreshed now and then).
  const loadMe = useCallback(() => {
    if (credentials?.member) accounts.me().then(setMe, () => undefined); // also in the demo, so the sidebar keeps them
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
        workspaces={credentials?.member ? (me?.workspaces ?? null) : null}
        currentId={credentials?.projectId ?? null}
        currentName={credentials?.projectName ?? watch.overview?.name ?? 'Workspace'}
        demo={isDemo}
        hasWorkspace={!!credentials}
        onOpen={(w) => (w.id === credentials?.projectId ? goHome() : open(w))}
        onCreate={credentials?.member ? async (name) => open(await accounts.createWorkspace(name)) : undefined}
        account={accountBlock(me, emailAlerts, toggleEmail, () => setSettingsOpen(true), watch.overview?.role, now)}
        devices={watching ? treeDevices : []}
        selectedDeviceId={watch.deviceId}
        onSelectDevice={(id) => {
          watch.selectDevice(id);
          markSeen([id]);
        }}
        deviceActions={deviceActions}
        onEditWorkspace={
          isOwner
            ? () => {
                setEditName(watch.overview?.name ?? '');
                setConfirmDelete(false);
                setEditError(null);
                setEditing(true);
              }
            : undefined
        }
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
              {role === 'device' ? 'This browser is listening' : watchedName ? `Live monitoring · ${watchedName}` : 'Live monitoring'}
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              {profile ? profile.label : 'Machine monitor'}
              {profile && <span className="ml-3 align-middle text-base font-medium tracking-normal text-ink-faint">{profile.id}</span>}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-10 gap-1.5 px-4" onClick={openAlerts}>
              <Bell aria-hidden className="size-4" />
              Alerts
              {events.filter((e) => e.ended_at === null).length > 0 && (
                <span className="num grid min-w-5 place-items-center rounded-md bg-anomaly px-1 text-[11px] font-semibold text-white">
                  {events.filter((e) => e.ended_at === null).length}
                  <span className="sr-only"> ongoing</span>
                </span>
              )}
            </Button>
          {(canManage || (role === 'device' && credentials?.home)) && (
            <>
              <Button variant="primary" className="min-h-10 gap-1.5 px-4" onClick={() => (canManage ? setAddSignal((n) => n + 1) : goHome('device'))}>
                <Plus aria-hidden className="size-4" />
                Add device
              </Button>
              {(role === 'member' || role === 'guest' || !!credentials?.home) && (
                <Button className="min-h-10 gap-1.5 px-4" onClick={() => (canManage ? setMemberSignal((n) => n + 1) : goHome('member'))}>
                  <UserPlus aria-hidden className="size-4" />
                  Add member
                </Button>
              )}
            </>
          )}
          </div>
        </div>

        {(!watching || !hasActiveDevices) && (
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
        )}

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


            {watching && watch.overview && (
              <DevicesCard overview={watch.overview} profiles={profiles} canManage={canManage} addSignal={addSignal} onChanged={watch.reload} headless />
            )}
            {(role === 'member' || role === 'guest') && watch.overview?.role && (
              <MembersCard myRole={watch.overview.role} isGuest={role === 'guest'} addSignal={memberSignal} />
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
          openAlerts();
        }}
        onDismiss={vm.dismissNewAlert}
      />

      <Modal open={alertsOpen} title={watchedName ? `Alerts · ${watchedName}` : 'Alerts'} onClose={() => setAlertsOpen(false)} wide>
        <AlertList events={events} profiles={profiles} now={now} onAcknowledge={vm.acknowledge} />
      </Modal>

      <Modal open={editing} title="Workspace" onClose={() => setEditing(false)}>
        <form onSubmit={renameWorkspace} className="grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold">Name</span>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              minLength={2}
              maxLength={60}
              required
              className="min-h-11 rounded-xl border border-line-strong bg-surface px-3 text-sm"
            />
          </label>
          <Button type="submit" variant="primary" className="min-h-11" disabled={editName.trim().length < 2 || editName.trim() === watch.overview?.name}>
            Save name
          </Button>
        </form>
        <div className="mt-5 border-t border-line pt-4">
          {confirmDelete ? (
            <div className="grid gap-2">
              <p className="text-sm">
                Delete <span className="font-semibold">{watch.overview?.name}</span> with all its devices, alert history and members? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <Button className="min-h-10 flex-1" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </Button>
                <Button variant="danger" className="min-h-10 flex-1" onClick={() => void deleteWorkspace()}>
                  Delete forever
                </Button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm font-semibold text-anomaly hover:underline">
              Delete workspace…
            </button>
          )}
        </div>
        {editError && <p role="alert" className="mt-3 text-sm text-anomaly">{editError}</p>}
      </Modal>

      <Drawer open={settingsOpen} title="Microphone & sound" onClose={() => setSettingsOpen(false)}>
        <SettingsPanel deviceId={micId} onDevice={setMicId} sound={sound} onSound={setSound} locked={running} />
      </Drawer>
    </div>
  );
}
