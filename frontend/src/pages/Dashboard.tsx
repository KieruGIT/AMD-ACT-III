import { useCallback, useEffect, useState } from 'react';
import { client } from '../api';
import type { SourceKind } from '../audio/sources';
import { AlertList } from '../components/alerts/AlertList';
import { AlertToast } from '../components/alerts/AlertToast';
import { AnomalyTrendChart } from '../components/charts/AnomalyTrendChart';
import { SpectrogramChart } from '../components/charts/SpectrogramChart';
import { WaveformChart } from '../components/charts/WaveformChart';
import { AppHeader, type DrawerId } from '../components/layout/AppHeader';
import { AssessmentCard } from '../components/monitoring/AssessmentCard';
import { ControlBar } from '../components/monitoring/ControlBar';
import { ModelInfoPanel } from '../components/monitoring/ModelInfoPanel';
import { SettingsPanel } from '../components/monitoring/SettingsPanel';
import { SignalChain } from '../components/monitoring/SignalChain';
import { StatusBanner } from '../components/monitoring/StatusBanner';
import { Drawer } from '../components/ui/Drawer';
import { Button, Panel, StatusChip } from '../components/ui/primitives';
import { useMonitoringSession } from '../hooks/useMonitoringSession';
import { useNow } from '../hooks/useNow';
import { playAlertTone } from '../lib/alertSound';
import { timeZoneLabel } from '../lib/format';
import { assessmentView } from '../lib/sessionReducer';

const DRAWER_TITLE: Record<DrawerId, string> = {
  alerts: 'Alert history',
  model: 'Model & system',
  settings: 'Settings',
};

export function Dashboard() {
  const session = useMonitoringSession();
  const { state, backend, events } = session;
  const now = useNow(500);
  const [drawer, setDrawer] = useState<DrawerId | null>(null);
  const [source, setSource] = useState<SourceKind>(client.mode === 'mock' ? 'simulated' : 'microphone');
  const [machineId, setMachineId] = useState('');
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [sound, setSound] = useState(false);

  const profiles = backend.config?.supported_profiles ?? [];
  const profile = profiles.find((p) => p.id === machineId) ?? profiles[0];

  const hopMs = backend.config?.input.hop_ms ?? 1000;
  const view = assessmentView(state, now, Math.max(3000, hopMs * 3));
  const activeEvent = events.find((e) => e.ended_at === null) ?? null;
  const running = state.status === 'monitoring' || state.status === 'interrupted';
  const capturing = running && !!state.source && state.error?.kind !== 'capture' && state.error?.kind !== 'permission';

  const start = useCallback(
    (kind: SourceKind = source) => {
      if (profile) void session.start(kind, profile.id, deviceId);
    },
    [deviceId, profile, session, source],
  );

  useEffect(() => {
    if (session.newAlert && sound) playAlertTone();
  }, [session.newAlert, sound]);

  return (
    <div className="min-h-dvh">
      <AppHeader mode={client.mode} openAlerts={events.filter((e) => e.ended_at === null).length} onOpen={setDrawer} />

      <main className="mx-auto grid max-w-[1440px] gap-5 px-4 pt-6 pb-16 sm:px-6 lg:px-8 lg:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <p className="eyebrow text-ink-faint">Live monitoring</p>
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
            <div className="grid gap-6">
              <WaveformChart bufferRef={session.bufferRef} sampleRate={state.source?.sampleRate ?? null} running={capturing} />
              <SpectrogramChart bufferRef={session.bufferRef} sampleRate={state.source?.sampleRate ?? null} running={capturing} />
            </div>
            {!state.source && (
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
            <AlertList events={events} profiles={profiles} now={now} onAcknowledge={session.acknowledge} limit={2} compact />
          </Panel>
        </div>

        <footer className="flex flex-wrap justify-between gap-2 pt-2 text-xs text-ink-faint">
          <p>Experimental prototype. Not a certified safety or diagnostic system. Alerts call for human inspection.</p>
          <p>Times shown in {timeZoneLabel()}</p>
        </footer>
      </main>

      <AlertToast
        event={session.newAlert}
        machineLabel={profile?.label ?? ''}
        onView={() => {
          session.dismissNewAlert();
          setDrawer('alerts');
        }}
        onDismiss={session.dismissNewAlert}
      />

      <Drawer open={drawer !== null} title={drawer ? DRAWER_TITLE[drawer] : ''} onClose={() => setDrawer(null)}>
        {drawer === 'alerts' && (
          <AlertList events={events} profiles={profiles} now={now} onAcknowledge={session.acknowledge} />
        )}
        {drawer === 'model' && <ModelInfoPanel backend={backend} state={state} mode={client.mode} />}
        {drawer === 'settings' && (
          <SettingsPanel deviceId={deviceId} onDevice={setDeviceId} sound={sound} onSound={setSound} locked={running} />
        )}
      </Drawer>
    </div>
  );
}
