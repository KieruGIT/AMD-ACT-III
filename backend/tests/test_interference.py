"""Interference flags: impacts (spectral flux), de-duplication across overlapping windows, API wiring, never decisive."""
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from app.inference.interference import InterferenceDetector, describe, impact_onsets
from ml.demo_fan import mix_bursts

from .conftest import fan_audio, to_wav

RATE = 16_000


class FakeSpeech:
    available = True
    error = None

    def __init__(self, seconds=0.0):
        self.seconds = seconds

    def speech_seconds(self, x):
        return self.seconds


def with_clap(x: np.ndarray, at_s: float) -> np.ndarray:
    y = x.copy()
    i = int(at_s * RATE)
    y[i : i + 400] += 0.8 * np.random.default_rng(3).standard_normal(400) * np.exp(-np.arange(400) / 80)
    return np.clip(y, -1, 1)


def test_impact_found_in_steady_fan_and_not_without_one():
    fan = fan_audio(3.0, RATE, seed=1)
    assert impact_onsets(fan) == []
    hits = impact_onsets(with_clap(fan, 1.7))
    assert len(hits) == 1 and abs(hits[0] - 1.7) < 0.05


def test_one_impact_is_reported_once_across_overlapping_windows():
    stream = with_clap(fan_audio(8.0, RATE, seed=2), 4.2)  # inside windows starting at 2, 3 and 4 s
    det, state, reported, flagged_windows = InterferenceDetector(speech=FakeSpeech()), {}, [], []
    for start in range(0, 6):
        info, state = det.analyze(stream[start * RATE : start * RATE + 3 * RATE], state, float(start))
        reported += [start + t for t in info["new_transients_at_s"]]
        if "transient" in info["flags"]:
            flagged_windows.append(start)
        assert info["affects_decision"] is False
    assert len(reported) == 1 and abs(reported[0] - 4.2) < 0.05  # one event...
    assert flagged_windows == [2, 3, 4]  # ...but every window containing it is flagged


def test_speech_flag_needs_enough_speech_and_describe_text():
    x = fan_audio(3.0, RATE, seed=4)
    assert InterferenceDetector(speech=FakeSpeech(0.1)).analyze(x, {}, 0.0)[0]["flags"] == []
    info, _ = InterferenceDetector(speech=FakeSpeech(1.4)).analyze(x, {}, 0.0)
    assert info["flags"] == ["speech"] and "speech (1.4 s)" in describe(info)
    assert describe({"flags": []}) is None


def test_mix_bursts_places_noise_every_20_seconds():
    base, noise = np.zeros(RATE * 50, np.float32), np.full(RATE * 2, 0.1, np.float32)
    mixed, spans = mix_bursts(base, noise)
    assert spans == [[5.0, 11.0], [25.0, 31.0], [45.0, 50.0]]
    assert mixed[RATE * 6] == pytest.approx(0.1) and mixed[RATE * 15] == 0


class BrokenSpeech(FakeSpeech):
    def speech_seconds(self, x):
        raise RuntimeError("VAD crashed")


def test_detector_errors_drop_the_flag_not_the_window():
    info, _ = InterferenceDetector(speech=BrokenSpeech()).analyze(fan_audio(3.0, RATE), {}, 0.0)
    assert info["speech_seconds"] is None and info["errors"] == ["speech: RuntimeError"]


def _post(client, project, seq, x, t, session="session-int01"):
    return client.post("/api/v1/analyze-window",
                       headers={"X-Project-Id": project["id"], "X-Device-Key": project["device_key"]},
                       data={"machine_id": "fan_01", "session_id": session, "sequence": str(seq),
                             "recorded_at": t.isoformat()},
                       files={"audio": ("w.wav", to_wav(x), "audio/wav")}).json()


def test_api_omits_field_by_default(client, project):
    r = _post(client, project, 1, fan_audio(), datetime.now(timezone.utc))
    assert "interference" not in r  # contract unchanged unless INTERFERENCE=flag


def test_api_flags_but_never_changes_status_or_alert(app, client, project):
    app.state.interference = InterferenceDetector(speech=FakeSpeech(2.0))
    t = datetime.now(timezone.utc)
    results = [_post(client, project, i + 1, fan_audio(seed=i), t + timedelta(seconds=i)) for i in range(8)]
    app.state.interference = None
    app.state.db.delete_baseline(project["device_id"])  # re-learn, so both runs see the same learning windows
    app.state.hub.forget_device(project["device_id"])
    plain = [_post(client, project, i + 1, fan_audio(seed=i), t + timedelta(seconds=i), session="session-int02")
             for i in range(8)]
    for flagged, clean in zip(results, plain):
        assert flagged["interference"]["flags"] == ["speech"]
        assert flagged["status"] == clean["status"] and flagged["anomaly_score"] == clean["anomaly_score"]
        assert flagged["alert"]["triggered"] == clean["alert"]["triggered"]
    assert results[-1]["note"].startswith("possible interference: speech")
    # windows 1-5 only learn the device's normal sound (not valid), so the policy counts windows 6-8
    last = results[-1]["interference"]
    assert last["recent_windows"] == 3 and last["recent_windows_flagged"] == 3 and last["recent_windows_unchecked"] == 0


def test_api_survives_a_crashing_interference_layer(app, client, project):
    class Boom:
        def analyze(self, *a):
            raise RuntimeError("boom")

    app.state.interference = Boom()
    r = _post(client, project, 1, fan_audio(), datetime.now(timezone.utc), session="session-int03")
    assert r["status"] in ("normal", "anomaly", "unable_to_assess") and r["interference"]["flags"] == []


def test_busy_detector_skips_the_window_without_touching_state():
    det, state = InterferenceDetector(speech=FakeSpeech(2.0)), {}
    det._lock.acquire()  # another request is mid-analysis
    try:
        info, next_state = det.analyze(fan_audio(3.0, RATE), state, 0.0)
    finally:
        det._lock.release()
    assert info["errors"] == ["busy"] and info["flags"] == [] and info["checked"] is False
    assert next_state is state and state == {}


def test_analyze_never_modifies_the_callers_state():
    x = with_clap(fan_audio(3.0, RATE, seed=7), 1.0)
    state = {"transients_seen": []}
    info, next_state = InterferenceDetector(speech=FakeSpeech()).analyze(x, state, 10.0)
    assert info["flags"] == ["transient"] and state == {"transients_seen": []}
    assert len(next_state["transients_seen"]) == 1


class SlowSpeech(FakeSpeech):
    def speech_seconds(self, x):
        import time

        time.sleep(2.0)
        return 2.0


def test_slow_detector_cannot_stall_the_window(app, client, project, monkeypatch):
    monkeypatch.setattr("app.routers.api.INTERFERENCE_BUDGET_S", 0.2)
    app.state.interference = InterferenceDetector(speech=SlowSpeech())
    r = _post(client, project, 1, fan_audio(), datetime.now(timezone.utc), session="session-int04")
    assert r["interference"]["errors"] == ["timeout"] and r["interference"]["flags"] == []
    assert r["processing"]["server_ms"] < 1500


def test_alert_event_and_notification_carry_the_interference_note(app, client, project, monkeypatch):
    from app.notify import format_message

    from .test_api import send

    delivered = []

    async def fake_deliver(subs, kind, proj, device, event):
        delivered.append(format_message(kind, proj, device, event)[1])

    monkeypatch.setattr("app.routers.api.deliver", fake_deliver)
    app.state.interference = InterferenceDetector(speech=FakeSpeech(2.0))
    results = [send(client, project, s, anomaly=s > 11, session="session-int05").json() for s in range(1, 30)]
    assert sum(r["alert"]["triggered"] for r in results) == 1
    events = client.get("/api/v1/sessions/session-int05/events",
                        headers={"X-Project-Id": project["id"], "X-Viewer-Key": project["viewer"]}).json()
    note = events[0]["interference_note"]
    assert note.startswith("possible interference in 5 of the 5 windows behind this alert (speech"), note
    assert "Note: possible interference" in delivered[0]  # the person alerted sees it too


def test_timed_out_worker_never_changes_session_state(app, client, project, monkeypatch):
    """Cancelling the wait does not stop the worker thread; its late result must be discarded, not committed."""
    import time

    monkeypatch.setattr("app.routers.api.INTERFERENCE_BUDGET_S", 0.2)
    app.state.interference = InterferenceDetector(speech=SlowSpeech())
    r = _post(client, project, 1, with_clap(fan_audio(3.0, 48_000), 1.0), datetime.now(timezone.utc),
              session="session-int06")
    assert r["interference"]["errors"] == ["timeout"]
    time.sleep(2.5)  # let the abandoned worker finish
    s = app.state.hub.session(project["device_id"], "session-int06")
    assert s.interference_state == {} and len(s.interference_history) == 0


def test_summary_follows_window_identity_not_analysis_count():
    from collections import OrderedDict

    from app.inference.interference import recent_summary, remember, summarize, unavailable

    history = OrderedDict()
    remember(history, "t1", {"flags": ["speech"], "checked": True})
    remember(history, "t2", {"flags": [], "checked": True})
    remember(history, "t3", unavailable("timeout"))  # never computed → unchecked, not clean
    ctx = summarize(history, ["t2", "t3"])  # e.g. after a gap reset the policy counts only t2, t3
    assert ctx == {"recent_windows": 2, "recent_windows_flagged": 0, "recent_windows_unchecked": 1, "recent_flags": []}
    assert "1 window(s) not checked" in recent_summary(ctx)
    assert summarize(history, ["t1", "t2"])["recent_windows_flagged"] == 1
