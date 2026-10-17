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


def test_delivers_telegram_and_discord_and_survives_a_failure(monkeypatch):
    monkeypatch.setattr(notify, "settings", dataclasses.replace(notify.settings, telegram_bot_token="123:abc"))
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append((str(req.url), json.loads(req.content)))
        return httpx.Response(500 if "broken" in str(req.url) else 200, json={"ok": True})

    subs = [
        {"name": "Chris", "channel": "telegram", "target": "987654"},
        {"name": "Ops", "channel": "discord", "target": "https://discord.test/webhook"},
        {"name": "Down", "channel": "webhook", "target": "https://broken.test/hook"},
    ]
    sent = asyncio.run(notify.deliver(subs, "opened", PROJECT, DEVICE, EVENT, transport=httpx.MockTransport(handler)))
    assert sent == ["telegram:Chris", "discord:Ops"]  # the failing webhook is logged, not raised
    tg_url, tg_body = seen[0]
    assert tg_url == "https://api.telegram.org/bot123:abc/sendMessage"
    assert tg_body["chat_id"] == "987654" and "Persistent acoustic anomaly on Phone at fan" in tg_body["text"]
    assert "not a probability" in tg_body["text"]
