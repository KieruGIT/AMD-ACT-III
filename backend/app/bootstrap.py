"""Recreate the demo project, device and alert recipients from environment secrets at startup.

For hosts whose disk is wiped on restart (e.g. a free Hugging Face Space): the SQLite file is lost, but the keys in
the dashboard/listener links must keep working. Set, as host secrets:

    BOOTSTRAP_PROJECT_ID=demo  BOOTSTRAP_VIEWER_KEY=vk_...  BOOTSTRAP_DEVICE_KEY=dk_...
    optional: BOOTSTRAP_PROJECT_NAME, BOOTSTRAP_DEVICE_NAME, BOOTSTRAP_MACHINE (default fan_01),
              BOOTSTRAP_SUBSCRIBERS="email:Chris:chris@example.com,discord:Ops:https://discord.com/api/webhooks/..."

Idempotent: existing rows are kept (the viewer key is re-applied so the configured link always works).
Keys are stored only as hashes, as with the admin CLI. Nothing happens unless BOOTSTRAP_PROJECT_ID is set.
"""
from __future__ import annotations

import os

from .db import CHANNELS, Database
from .profiles import PROFILES


def bootstrap(db: Database, env: dict[str, str] | None = None) -> str | None:
    env = dict(os.environ) if env is None else env
    project_id = env.get("BOOTSTRAP_PROJECT_ID")
    if not project_id:
        return None
    viewer_key, device_key = env.get("BOOTSTRAP_VIEWER_KEY"), env.get("BOOTSTRAP_DEVICE_KEY")
    if not viewer_key or not device_key:
        raise RuntimeError("BOOTSTRAP_PROJECT_ID needs BOOTSTRAP_VIEWER_KEY and BOOTSTRAP_DEVICE_KEY")
    machine = env.get("BOOTSTRAP_MACHINE", "fan_01")
    if machine not in PROFILES:
        raise RuntimeError(f"BOOTSTRAP_MACHINE: unsupported profile {machine}")
    db.ensure_project(project_id, env.get("BOOTSTRAP_PROJECT_NAME", "Demo"), viewer_key)
    db.ensure_device(project_id, env.get("BOOTSTRAP_DEVICE_NAME", "Phone at fan"), machine, device_key)
    for entry in filter(None, (s.strip() for s in env.get("BOOTSTRAP_SUBSCRIBERS", "").split(","))):
        channel, name, target = entry.split(":", 2)
        if channel not in CHANNELS:
            raise RuntimeError(f"BOOTSTRAP_SUBSCRIBERS: unknown channel {channel}")
        db.ensure_subscriber(project_id, name, channel, target)
    return project_id
