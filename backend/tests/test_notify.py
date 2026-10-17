import asyncio
import dataclasses
import json

import httpx

import app.notify as notify

EVENT = {"event_id": "evt_1", "machine_id": "fan_01", "started_at": "2026-10-16T07:00:00+00:00", "ended_at": None,
         "reason": "3 of the last 5 valid windows exceeded threshold", "peak_score": 4.2, "threshold": 3.0,
         "anomalous_window_count": 3}
PROJECT = {"id": "plant-a", "name": "Plant A"}
DEVICE = {"name": "Phone at fan"}


def test_email_only_and_a_failure_does_not_stop_the_rest(monkeypatch):
    monkeypatch.setattr(notify, "settings", dataclasses.replace(notify.settings, resend_api_key="re_test"))
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        to = json.loads(req.content)["to"][0]
        seen.append(to)
        return httpx.Response(500 if to.startswith("down") else 200, json={"id": "e"})

    subs = [
        {"name": "Down", "channel": "email", "target": "down@example.com"},
        {"name": "Old", "channel": "discord", "target": "https://discord.test/webhook"},  # legacy row: skipped
        {"name": "Ops", "channel": "email", "target": "ops@example.com"},
    ]
    sent = asyncio.run(notify.deliver(subs, "opened", PROJECT, DEVICE, EVENT, transport=httpx.MockTransport(handler)))
    assert sent == ["email:Ops"] and seen == ["down@example.com", "ops@example.com"]


def test_invitation_mail(monkeypatch):
    monkeypatch.setattr(notify, "settings", dataclasses.replace(notify.settings, resend_api_key="re_test",
                                                                public_app_url="https://msm.test"))
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(json.loads(req.content))
        return httpx.Response(200, json={"id": "e"})

    ok = asyncio.run(notify.send_invitation("new@example.com", "Plant A", "viewer", "boss@example.com",
                                            transport=httpx.MockTransport(handler)))
    assert ok and seen[0]["to"] == ["new@example.com"] and "https://msm.test/signin" in seen[0]["text"]


def test_email_goes_through_resend(monkeypatch):
    monkeypatch.setattr(notify, "settings", dataclasses.replace(notify.settings, resend_api_key="re_test",
                                                                email_from="Monitor <alerts@example.com>"))
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append((str(req.url), req.headers["authorization"], json.loads(req.content)))
        return httpx.Response(200, json={"id": "e1"})

    subs = [{"name": "Ops", "channel": "email", "target": "ops@example.com"}]
    sent = asyncio.run(notify.deliver(subs, "opened", PROJECT, DEVICE, EVENT, transport=httpx.MockTransport(handler)))
    url, auth, body = seen[0]
    assert sent == ["email:Ops"] and url == "https://api.resend.com/emails" and auth == "Bearer re_test"
    assert body["to"] == ["ops@example.com"] and body["from"] == "Monitor <alerts@example.com>"
    assert body["subject"].startswith("Persistent acoustic anomaly")
