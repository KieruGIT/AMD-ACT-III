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


def test_delivers_discord_and_slack_and_survives_a_failure():
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append((str(req.url), json.loads(req.content)))
        return httpx.Response(500 if "broken" in str(req.url) else 200, json={"ok": True})

    subs = [
        {"name": "Ops", "channel": "discord", "target": "https://discord.test/webhook"},
        {"name": "Team", "channel": "slack", "target": "https://slack.test/hook"},
        {"name": "Down", "channel": "webhook", "target": "https://broken.test/hook"},
    ]
    sent = asyncio.run(notify.deliver(subs, "opened", PROJECT, DEVICE, EVENT, transport=httpx.MockTransport(handler)))
    assert sent == ["discord:Ops", "slack:Team"]  # the failing webhook is logged, not raised
    dc_url, dc_body = seen[0]
    assert dc_url == "https://discord.test/webhook"
    assert "Persistent acoustic anomaly on Phone at fan" in dc_body["content"] and "not a probability" in dc_body["content"]


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
