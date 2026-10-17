"""SQLite persistence for projects, devices, subscribers and alert events.

Raw audio is never stored. Window results live in memory only (app/live.py).
"""
from __future__ import annotations

import hashlib
import secrets
import sqlite3
import threading
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from .alerting.policy import AlertEvent

CHANNELS = ("telegram", "discord", "slack", "webhook", "email")

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, viewer_key_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL,
  machine_id TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_seen_at TEXT);
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL, channel TEXT NOT NULL,
  target TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, device_id TEXT NOT NULL, session_id TEXT NOT NULL,
  machine_id TEXT NOT NULL, started_at TEXT NOT NULL, last_anomalous_at TEXT NOT NULL, ended_at TEXT,
  anomalous_window_count INTEGER NOT NULL, peak_score REAL NOT NULL, threshold REAL NOT NULL,
  reason TEXT NOT NULL, acknowledged_at TEXT);
CREATE INDEX IF NOT EXISTS events_project ON events(project_id, started_at);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def new_key(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(24)}"


class Database:
    def __init__(self, path: str):
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._conn.executescript(SCHEMA)

    def _q(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        with self._lock:
            cur = self._conn.execute(sql, args)
            rows = cur.fetchall()
            self._conn.commit()
            return rows

    # --- admin -------------------------------------------------------------------------------
    def create_project(self, project_id: str, name: str) -> str:
        viewer_key = new_key("vk")
        self._q("INSERT INTO projects VALUES (?,?,?,?)", (project_id, name, hash_key(viewer_key), now_iso()))
        return viewer_key

    def create_device(self, project_id: str, name: str, machine_id: str) -> tuple[str, str]:
        device_id = f"dev_{secrets.token_hex(4)}"
        device_key = new_key("dk")
        self._q("INSERT INTO devices (id, project_id, name, machine_id, key_hash, created_at) VALUES (?,?,?,?,?,?)",
                (device_id, project_id, name, machine_id, hash_key(device_key), now_iso()))
        return device_id, device_key

    def add_subscriber(self, project_id: str, name: str, channel: str, target: str) -> None:
        if channel not in CHANNELS:
            raise ValueError(f"channel must be one of {CHANNELS}")
        self._q("INSERT INTO subscribers (project_id, name, channel, target, created_at) VALUES (?,?,?,?,?)",
                (project_id, name, channel, target, now_iso()))

    # --- lookups -----------------------------------------------------------------------------
    def project(self, project_id: str) -> sqlite3.Row | None:
        rows = self._q("SELECT * FROM projects WHERE id = ?", (project_id,))
        return rows[0] if rows else None

    def device_by_key(self, project_id: str, device_key: str) -> sqlite3.Row | None:
        rows = self._q("SELECT * FROM devices WHERE project_id = ? AND key_hash = ?", (project_id, hash_key(device_key)))
        return rows[0] if rows else None

    def devices(self, project_id: str) -> list[sqlite3.Row]:
        return self._q("SELECT id, name, machine_id, created_at, last_seen_at FROM devices WHERE project_id = ? ORDER BY name",
                       (project_id,))

    def touch_device(self, device_id: str) -> None:
        self._q("UPDATE devices SET last_seen_at = ? WHERE id = ?", (now_iso(), device_id))

    def subscribers(self, project_id: str) -> list[sqlite3.Row]:
        return self._q("SELECT * FROM subscribers WHERE project_id = ?", (project_id,))

    # --- events ------------------------------------------------------------------------------
    def upsert_event(self, project_id: str, device_id: str, ev: AlertEvent) -> None:
        with self._lock:
            self._conn.execute(
                """INSERT INTO events (event_id, project_id, device_id, session_id, machine_id, started_at,
                     last_anomalous_at, ended_at, anomalous_window_count, peak_score, threshold, reason, acknowledged_at)
                   VALUES (:event_id, :project_id, :device_id, :session_id, :machine_id, :started_at, :last_anomalous_at,
                     :ended_at, :anomalous_window_count, :peak_score, :threshold, :reason, :acknowledged_at)
                   ON CONFLICT(event_id) DO UPDATE SET last_anomalous_at = excluded.last_anomalous_at,
                     ended_at = excluded.ended_at, anomalous_window_count = excluded.anomalous_window_count,
                     peak_score = excluded.peak_score""",
                {**asdict(ev), "project_id": project_id, "device_id": device_id},
            )
            self._conn.commit()

    def events(self, project_id: str, session_id: str | None = None, limit: int = 100) -> list[dict]:
        sql = "SELECT * FROM events WHERE project_id = ?" + (" AND session_id = ?" if session_id else "")
        args = (project_id, session_id) if session_id else (project_id,)
        return [dict(r) for r in self._q(sql + " ORDER BY started_at DESC LIMIT ?", (*args, limit))]

    def acknowledge(self, project_id: str, event_id: str) -> dict | None:
        self._q("UPDATE events SET acknowledged_at = COALESCE(acknowledged_at, ?) WHERE project_id = ? AND event_id = ?",
                (now_iso(), project_id, event_id))
        rows = self._q("SELECT * FROM events WHERE project_id = ? AND event_id = ?", (project_id, event_id))
        return dict(rows[0]) if rows else None
