from datetime import datetime, timedelta, timezone

import pytest

from .conftest import fan_audio, to_wav

T0 = datetime(2026, 10, 16, 7, 0, tzinfo=timezone.utc)


def send(client, project, seq, *, anomaly=False, session="session-0001", key=None, machine="fan_01", audio=None):
    return client.post(
        "/api/v1/analyze-window",
        headers={"X-Project-Id": project["id"], "X-Device-Key": key or project["device_key"]},
        data={"machine_id": machine, "session_id": session, "sequence": str(seq),
              "recorded_at": (T0 + timedelta(seconds=seq)).isoformat()},
        files={"audio": ("w.wav", audio or to_wav(fan_audio(anomaly=anomaly, seed=seq)), "audio/wav")},
    )


def test_health_and_config_are_public(client):
    h = client.get("/api/v1/health").json()
    assert h == {"service": "ok", "model_ready": True, "mode": "heuristic", "model_version": "session-baseline-heuristic-0.1"}
    c = client.get("/api/v1/config").json()
    assert c["input"]["sample_rate_hz"] == 16_000 and 48_000 in c["input"]["accepted_sample_rates_hz"]
    assert c["score"]["is_probability"] is False


@pytest.mark.parametrize("headers, code", [({}, 401), ({"X-Project-Id": "plant-a", "X-Device-Key": "dk_wrong"}, 403)])
def test_upload_requires_valid_device_key(client, project, headers, code):
    r = client.post("/api/v1/analyze-window", headers=headers,
                    data={"machine_id": "fan_01", "session_id": "session-0001", "sequence": "1", "recorded_at": T0.isoformat()},
                    files={"audio": ("w.wav", to_wav(fan_audio()), "audio/wav")})
    assert r.status_code == code


def test_rejects_wrong_machine_and_bad_audio(client, project):
    assert send(client, project, 1, machine="pump_99").status_code == 422
    assert send(client, project, 1, audio=b"junk").status_code == 422


def test_end_to_end_baseline_normal_then_one_alert(client, project, monkeypatch):
    delivered = []

    async def fake_deliver(subs, kind, proj, device, event):
        delivered.append((kind, event["event_id"]))

    monkeypatch.setattr("app.routers.api.deliver", fake_deliver)

    results = [send(client, project, s).json() for s in range(1, 6)]
    assert all(r["status"] == "unable_to_assess" and r["note"] for r in results)  # learning baseline
    normal = [send(client, project, s).json() for s in range(6, 12)]
    assert all(r["status"] == "normal" for r in normal)
    abnormal = [send(client, project, s, anomaly=True).json() for s in range(12, 30)]
    assert sum(r["alert"]["triggered"] for r in abnormal) == 1  # one event, not one per window
    assert delivered and delivered[0][0] == "opened"

    events = client.get("/api/v1/sessions/session-0001/events",
                        headers={"X-Project-Id": "plant-a", "X-Viewer-Key": project["viewer"]}).json()
    assert len(events) == 1 and events[0]["ended_at"] is None

    for s in range(30, 36):
        send(client, project, s)
    assert [k for k, _ in delivered] == ["opened", "recovered"]

    ack = client.post(f"/api/v1/sessions/session-0001/events/{events[0]['event_id']}/ack",
                      headers={"X-Project-Id": "plant-a", "X-Device-Key": project["device_key"]})
    assert ack.status_code == 200 and ack.json()["acknowledged_at"]


def test_duplicate_is_idempotent_and_stale_sequence_rejected(client, project):
    first = send(client, project, 1).json()
    assert send(client, project, 1).json() == first
    send(client, project, 2)
    # sequence 1 is still cached → same answer; an uncached older one is a conflict
    assert send(client, project, 1).status_code == 200


def test_out_of_order_uncached_sequence_conflicts(client, project):
    for s in range(1, 25):
        send(client, project, s)
    assert send(client, project, 2).status_code == 409


def test_project_overview_requires_viewer_key(client, project):
    assert client.get("/api/v1/projects/plant-a").status_code == 401
    send(client, project, 1)
    r = client.get("/api/v1/projects/plant-a", headers={"X-Viewer-Key": project["viewer"]}).json()
    assert r["name"] == "Plant A" and r["devices"][0]["latest"]["sequence"] == 1


def test_model_not_ready_returns_503(client, project, app):
    app.state.scorer.ready = False
    assert send(client, project, 1).status_code == 503
    app.state.scorer.ready = True


def test_no_raw_audio_persisted(client, project, app):
    send(client, project, 1)
    tables = app.state.db._q("SELECT name FROM sqlite_master WHERE type='table'")
    for t in tables:
        cols = [c[1] for c in app.state.db._q(f"PRAGMA table_info({t['name']})")]
        assert not any("audio" in c or "pcm" in c for c in cols)
