"""Admin CLI: create projects, devices and the people to alert.

    python -m app.admin create-project plant-a "Plant A"
    python -m app.admin add-device plant-a "Fan line 1" --machine fan_01
    python -m app.admin add-subscriber plant-a "Maintenance" --discord https://discord.com/api/webhooks/...
    python -m app.admin list plant-a

Keys are printed once and stored only as hashes.
"""
from __future__ import annotations

import argparse
import re
import sys

import httpx

from .db import CHANNELS, Database
from .profiles import PROFILES
from .settings import settings


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m app.admin")
    sub = p.add_subparsers(dest="cmd", required=True)

    cp = sub.add_parser("create-project")
    cp.add_argument("project_id")
    cp.add_argument("name")

    ad = sub.add_parser("add-device")
    ad.add_argument("project_id")
    ad.add_argument("name")
    ad.add_argument("--machine", default="fan_01", choices=sorted(PROFILES))

    asb = sub.add_parser("add-subscriber")
    asb.add_argument("project_id")
    asb.add_argument("name")
    ch = asb.add_mutually_exclusive_group(required=True)
    for c in CHANNELS:
        ch.add_argument(f"--{c}", metavar="CHAT_ID" if c == "telegram" else "TARGET")

    sub.add_parser("telegram-chats", help="list chats that pressed Start on the bot (to get chat ids)")

    ls = sub.add_parser("list")
    ls.add_argument("project_id")

    a = p.parse_args(argv)
    db = Database(settings.db_path)
    app_url = settings.public_app_url.rstrip("/")

    if a.cmd == "create-project":
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,40}", a.project_id):
            p.error("project_id: lowercase letters, digits and dashes")
        key = db.create_project(a.project_id, a.name)
        print(f"Project {a.project_id} created.\nViewer key (shown once): {key}")
        print(f"Dashboard link: {app_url}/app?project={a.project_id}#viewer={key}")
    elif a.cmd == "add-device":
        if not db.project(a.project_id):
            p.error(f"unknown project {a.project_id}")
        device_id, key = db.create_device(a.project_id, a.name, a.machine)
        print(f"Device {device_id} ({a.name}, {a.machine}) created.\nDevice key (shown once): {key}")
        print(f"Listener link (open on the phone): {app_url}/app?project={a.project_id}#device={key}")
    elif a.cmd == "add-subscriber":
        if not db.project(a.project_id):
            p.error(f"unknown project {a.project_id}")
        channel = next(c for c in CHANNELS if getattr(a, c))
        db.add_subscriber(a.project_id, a.name, channel, getattr(a, channel))
        print(f"{a.name} will be alerted via {channel}.")
    elif a.cmd == "telegram-chats":
        if not settings.telegram_bot_token:
            p.error("set TELEGRAM_BOT_TOKEN first (from @BotFather)")
        r = httpx.get(f"https://api.telegram.org/bot{settings.telegram_bot_token}/getUpdates", timeout=10).json()
        chats = {u["message"]["chat"]["id"]: u["message"]["chat"] for u in r.get("result", []) if "message" in u}
        if not chats:
            print("No chats yet: open the bot in Telegram, press Start, then run this again.")
        for cid, c in chats.items():
            print(f"{cid}  {c.get('title') or c.get('first_name', '')} {c.get('username', '')}")
    elif a.cmd == "list":
        for d in db.devices(a.project_id):
            print(f"device  {d['id']}  {d['name']}  {d['machine_id']}  last seen {d['last_seen_at'] or 'never'}")
        for s in db.subscribers(a.project_id):
            print(f"alert   {s['name']}  via {s['channel']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
