import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { httpClient } from '../api';
import { initialSession, sessionReducer } from '../lib/sessionReducer';
import type { AlertEvent, ProjectOverview, StreamMessage } from '../types/monitoring';

const OVERVIEW_POLL_MS = 5000;

/**
 * Watches a project's listening devices from another screen. Results arrive over the backend's
 * stream and drive the same reducer as local capture, so staleness/interruption rules are identical.
 */
export function useProjectWatch(enabled: boolean) {
  const [state, dispatch] = useReducer(sessionReducer, initialSession);
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [deviceId, setDeviceIdState] = useState<string | null>(null);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [newAlert, setNewAlert] = useState<AlertEvent | null>(null);
  const deviceRef = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const overviewRef = useRef<ProjectOverview | null>(null);

  const upsertEvent = useCallback((ev: AlertEvent) => {
    setEvents((list) => [ev, ...list.filter((e) => e.event_id !== ev.event_id)]);
  }, []);

  const selectDevice = useCallback((id: string | null) => {
    deviceRef.current = id;
    sessionRef.current = null;
    setDeviceIdState(id);
    setNewAlert(null);
    dispatch({ type: 'stopped' });
    const ov = overviewRef.current;
    setEvents(ov && id ? ov.events.filter((e) => e.device_id === id) : []);
  }, []);

  // Device list (with last-seen) refreshes in the background.
  useEffect(() => {
    if (!enabled || !httpClient) return;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const ov = await httpClient!.project(ctrl.signal);
        overviewRef.current = ov;
        setOverview(ov);
        setOverviewError(null);
        if (!deviceRef.current && ov.devices[0]) selectDevice(ov.devices[0].id);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setOverviewError((err as Error).message);
      }
    };
    void load();
    const t = setInterval(load, OVERVIEW_POLL_MS);
    return () => {
      clearInterval(t);
      ctrl.abort();
    };
  }, [enabled, selectDevice]);

  // Live stream with reconnect.
  useEffect(() => {
    if (!enabled || !httpClient) return;
    const ctrl = new AbortController();
    const onMessage = (m: StreamMessage) => {
      if (m.type === 'event') {
        if (m.event.device_id === deviceRef.current) upsertEvent(m.event);
        return;
      }
      if (m.device_id !== deviceRef.current) return;
      const r = m.result;
      if (r.session_id !== sessionRef.current) {
        sessionRef.current = r.session_id; // device started a new monitoring session
        dispatch({ type: 'start_requested' });
        dispatch({ type: 'started', sessionId: r.session_id, source: { kind: 'remote', label: m.device_name, sampleRate: 0 } });
      }
      dispatch({ type: 'result', result: r, receivedAt: m.replay ? Date.parse(r.recorded_at) : Date.now(), roundTripMs: null });
      if (m.event) {
        upsertEvent(m.event);
        if (r.alert.triggered && !m.replay) setNewAlert(m.event);
      }
    };
    (async () => {
      let backoff = 1000;
      while (!ctrl.signal.aborted) {
        try {
          await httpClient!.stream((m) => {
            backoff = 1000;
            onMessage(m);
          }, ctrl.signal);
        } catch (err) {
          if (ctrl.signal.aborted) return;
          dispatch({ type: 'request_failed', message: (err as Error).message });
        }
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 10_000);
      }
    })();
    return () => ctrl.abort();
  }, [enabled, upsertEvent]);

  const acknowledge = useCallback(
    async (eventId: string) => {
      const ev = events.find((e) => e.event_id === eventId);
      if (!ev || !httpClient) return;
      upsertEvent(await httpClient.acknowledge(ev.session_id, eventId));
    },
    [events, upsertEvent],
  );

  return {
    state,
    overview,
    overviewError,
    deviceId,
    selectDevice,
    events,
    newAlert,
    dismissNewAlert: () => setNewAlert(null),
    acknowledge,
  };
}
