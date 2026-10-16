import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { client, mockClient } from '../api';
import type { MockScenario } from '../api/mockMonitoringClient';
import { RollingBuffer } from '../audio/rollingBuffer';
import {
  CaptureError,
  startMicrophone,
  startSimulated,
  type AudioSource,
  type SimulatedProfile,
  type SourceKind,
} from '../audio/sources';
import { wavBlob } from '../audio/wavEncoder';
import { initialSession, sessionReducer } from '../lib/sessionReducer';
import type { AlertEvent, ConfigResponse, HealthResponse } from '../types/monitoring';

const BUFFER_SECONDS = 15; // waveform/spectrogram history; must exceed the analysis window

const simulatedProfile = (s: MockScenario | undefined): SimulatedProfile =>
  s === 'anomaly' ? 'anomaly' : s === 'transient_spike' ? 'spike' : s === 'silence' ? 'silence' : 'normal';

export interface BackendInfo {
  config: ConfigResponse | null;
  health: HealthResponse | null;
  error: string | null;
  loading: boolean;
}

export function useMonitoringSession() {
  const [state, dispatch] = useReducer(sessionReducer, initialSession);
  const [backend, setBackend] = useState<BackendInfo>({ config: null, health: null, error: null, loading: true });
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [newAlert, setNewAlert] = useState<AlertEvent | null>(null);
  const [scenario, setScenarioState] = useState<MockScenario | undefined>(mockClient?.scenario);

  const bufferRef = useRef<RollingBuffer | null>(null);
  const sourceRef = useRef<AudioSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inflightRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<string | null>(null);
  const seqRef = useRef(0);
  const scenarioRef = useRef(scenario);

  const loadBackend = useCallback(async () => {
    setBackend((b) => ({ ...b, loading: true, error: null }));
    try {
      const [health, config] = await Promise.all([client.health(), client.config()]);
      setBackend({ health, config, error: null, loading: false });
    } catch (err) {
      setBackend((b) => ({ ...b, loading: false, error: (err as Error).message }));
    }
  }, []);

  useEffect(() => {
    void loadBackend();
  }, [loadBackend]);

  const refreshEvents = useCallback(async (sessionId: string) => {
    try {
      const list = await client.events(sessionId);
      if (sessionRef.current !== sessionId) return null;
      setEvents(list);
      return list;
    } catch {
      return null; // a failing backend is already surfaced by the window loop's interruption state
    }
  }, []);

  const teardown = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    inflightRef.current?.abort();
    inflightRef.current = null;
    sourceRef.current?.stop();
    sourceRef.current = null;
  }, []);

  const stop = useCallback(() => {
    teardown();
    bufferRef.current?.clear(); // discard buffered audio; nothing raw is retained
    dispatch({ type: 'stopped' });
  }, [teardown]);

  const sendWindow = useCallback(
    async (cfg: ConfigResponse, machineId: string) => {
      const buf = bufferRef.current;
      const src = sourceRef.current;
      const sessionId = sessionRef.current;
      if (!buf || !src || !sessionId) return;
      const windowSamples = Math.round((src.sampleRate * cfg.input.window_ms) / 1000);
      if (buf.size < windowSamples) return; // still filling the first window
      if (inflightRef.current) {
        dispatch({ type: 'window_skipped' }); // one request in flight; drop stale work
        return;
      }

      const audio = wavBlob(buf.latest(windowSamples), src.sampleRate);
      const ctrl = new AbortController();
      inflightRef.current = ctrl;
      const sequence = ++seqRef.current;
      const sentAt = performance.now();
      dispatch({ type: 'window_sent' });
      try {
        const result = await client.analyzeWindow(
          { audio, machine_id: machineId, session_id: sessionId, sequence, recorded_at: new Date().toISOString() },
          ctrl.signal,
        );
        dispatch({ type: 'result', result, receivedAt: Date.now(), roundTripMs: Math.round(performance.now() - sentAt) });
        // Refresh events while one is open so duration/recovery stay current.
        const eventId = result.alert.event_id;
        if (eventId) {
          const list = await refreshEvents(sessionId);
          if (result.alert.triggered) setNewAlert(list?.find((e) => e.event_id === eventId) ?? null);
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') dispatch({ type: 'request_failed', message: (err as Error).message });
      } finally {
        if (inflightRef.current === ctrl) inflightRef.current = null;
      }
    },
    [refreshEvents],
  );

  const start = useCallback(
    async (kind: SourceKind, machineId: string, deviceId: string | null) => {
      const cfg = backend.config;
      if (!cfg) return;
      teardown();
      dispatch({ type: 'start_requested' });
      setEvents([]);
      setNewAlert(null);
      seqRef.current = 0;

      const onChunk = (c: Float32Array) => bufferRef.current?.push(c);
      const onEnded = () => {
        teardown();
        dispatch({ type: 'interrupted', kind: 'capture', message: 'The microphone stopped delivering audio (device unplugged or permission revoked).' });
      };

      let src: AudioSource;
      try {
        if (scenarioRef.current === 'mic_denied') {
          throw new CaptureError('permission', 'Microphone access was blocked (simulated by the mic_denied scenario).');
        }
        src = kind === 'microphone'
          ? await startMicrophone(deviceId, onChunk, onEnded)
          : startSimulated(onChunk, () => simulatedProfile(scenarioRef.current));
      } catch (err) {
        const ce = err instanceof CaptureError ? err : new CaptureError('capture', (err as Error).message);
        dispatch({ type: 'start_failed', kind: ce.kind, message: ce.message });
        return;
      }

      bufferRef.current = new RollingBuffer(Math.round(src.sampleRate * BUFFER_SECONDS));
      sourceRef.current = src;
      const sessionId = crypto.randomUUID();
      sessionRef.current = sessionId;
      dispatch({ type: 'started', sessionId, source: { kind: src.kind, label: src.label, sampleRate: src.sampleRate } });
      timerRef.current = setInterval(() => void sendWindow(cfg, machineId), cfg.input.hop_ms);
    },
    [backend.config, sendWindow, teardown],
  );

  // A hidden tab is throttled by the browser, so live status cannot be trusted until it is visible again.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && sourceRef.current) {
        dispatch({ type: 'interrupted', kind: 'hidden', message: 'The tab was hidden; browsers throttle background tabs.' });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => teardown, [teardown]);

  const setScenario = useCallback(
    (s: MockScenario) => {
      if (!mockClient) return;
      mockClient.setScenario(s);
      scenarioRef.current = s;
      setScenarioState(s);
      if (s === 'mic_denied' && sourceRef.current) {
        teardown();
        dispatch({ type: 'interrupted', kind: 'permission', message: 'Microphone permission was revoked (simulated).' });
      }
      if (s !== 'backend_offline' && backend.error) void loadBackend();
    },
    [backend.error, loadBackend, teardown],
  );

  const acknowledge = useCallback(async (eventId: string) => {
    const sessionId = sessionRef.current;
    if (!sessionId) return;
    const updated = await client.acknowledge(sessionId, eventId);
    setEvents((list) => list.map((e) => (e.event_id === eventId ? updated : e)));
  }, []);

  return {
    state,
    backend,
    events,
    newAlert,
    dismissNewAlert: () => setNewAlert(null),
    bufferRef,
    start,
    stop,
    acknowledge,
    reloadBackend: loadBackend,
    scenario,
    setScenario,
  };
}

export type MonitoringSession = ReturnType<typeof useMonitoringSession>;
