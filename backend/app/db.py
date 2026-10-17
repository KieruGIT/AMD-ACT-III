"""Persistence for workspaces (projects), members, devices, pairing codes, subscribers, alert events and the audit log.

Two engines behind one interface: SQLite (`DB_PATH`, local dev and tests) and Postgres (`DATABASE_URL`, e.g. Supabase,
so accounts and history survive restarts of a stateless host). Queries are written once with `?` placeholders.
Raw audio is never stored. Window results live in memory only (app/live.py).
"""
from __future__ import annotations

import hashlib
import secrets
import sqlite3
import threading
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .alerting.policy import AlertEvent

CHANNELS = ("email",)  # alerts go out by e-mail (Resend)
ROLES = ("owner", "admin", "viewer")
PAIRING_TTL = timedelta(minutes=10)
GUEST_TTL = timedelta(hours=2)
LISTENING_WINDOW = timedelta(seconds=15)  # a device seen this recently counts as listening now
APPROVAL_TTL = timedelta(minutes=10)  # a device waiting for approval longer than this is dropped
PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I

_TABLES = """
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, viewer_key_hash TEXT, created_at TEXT NOT NULL,
  is_guest INTEGER NOT NULL DEFAULT 0, expires_at TEXT);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL,
  machine_id TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_seen_at TEXT, revoked_at TEXT,
  pending INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS subscribers (
  id {serial}, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, channel TEXT NOT NULL, target TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL, session_id TEXT NOT NULL,
  machine_id TEXT NOT NULL, started_at TEXT NOT NULL, last_anomalous_at TEXT NOT NULL, ended_at TEXT,
  anomalous_window_count INTEGER NOT NULL, peak_score REAL NOT NULL, threshold REAL NOT NULL,
  reason TEXT NOT NULL, acknowledged_at TEXT, interference_note TEXT, acknowledged_by TEXT);
CREATE INDEX IF NOT EXISTS events_project ON events(project_id, started_at);
CREATE TABLE IF NOT EXISTS members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL, email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','viewer')), created_at TEXT NOT NULL,
  email_alerts INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (project_id, user_id));
CREATE INDEX IF NOT EXISTS members_user ON members(user_id);
CREATE TABLE IF NOT EXISTS invitations (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','viewer')), invited_by TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, email));
CREATE TABLE IF NOT EXISTS pairing_codes (
  code_hash TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL, machine_id TEXT NOT NULL, created_by TEXT NOT NULL, expires_at TEXT NOT NULL,
  used_at TEXT);
CREATE TABLE IF NOT EXISTS audit_log (
  id {serial}, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS audit_project ON audit_log(project_id, at);
CREATE TABLE IF NOT EXISTS baselines (
  device_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL, data TEXT NOT NULL, windows INTEGER NOT NULL, created_at TEXT NOT NULL);
"""
# Columns added after the first release (SQLite files created earlier get them on startup).
_ADDED = {"events": {"interference_note": "TEXT", "acknowledged_by": "TEXT"},
          "devices": {"revoked_at": "TEXT", "pending": "INTEGER NOT NULL DEFAULT 0"},
          "projects": {"is_guest": "INTEGER NOT NULL DEFAULT 0", "expires_at": "TEXT"},
          "members": {"email_alerts": "INTEGER NOT NULL DEFAULT 1"}}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="milliseconds")


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def new_key(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(24)}"


def normalize_code(code: str) -> str:
    return "".join(c for c in code.upper() if c.isalnum())


class Database:
    """`url`: a SQLite path / ":memory:", or a postgres:// connection string."""

    def __init__(self, url: str):
        self._lock = threading.Lock()
        self.engine = "postgres" if url.startswith(("postgres://", "postgresql://")) else "sqlite"
        self._url = url
        if self.engine == "postgres":
            self._connect_pg()
            with self._lock:
                for stmt in _statements(_TABLES.format(serial="BIGSERIAL PRIMARY KEY")):
                    self._conn.execute(stmt)
                for table, cols in _ADDED.items():
                    for col, decl in cols.items():
                        self._conn.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {decl}")
        else:
            if url != ":memory:":
                Path(url).parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(url, check_same_thread=False)
            self._conn.row_factory = sqlite3.Row
            with self._lock:
                self._conn.execute("PRAGMA foreign_keys = ON")
                for stmt in _statements(_TABLES.format(serial="INTEGER PRIMARY KEY AUTOINCREMENT")):
                    if "CREATE INDEX" in stmt:
                        continue  # after migrations: an index may use a column an old file lacks
                    self._conn.execute(stmt)
                for table, cols in _ADDED.items():
                    have = {r[1] for r in self._conn.execute(f"PRAGMA table_info({table})")}
                    for col, decl in cols.items():
                        if col not in have:
                            self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
                for stmt in _statements(_TABLES.format(serial="")):
                    if "CREATE INDEX" in stmt:
                        self._conn.execute(stmt)
                self._conn.commit()

    def _connect_pg(self) -> None:
        import psycopg
        from psycopg.rows import dict_row

        # prepare_threshold=None: safe behind connection poolers (Supabase pooler)
        self._conn = psycopg.connect(self._url, autocommit=True, row_factory=dict_row, prepare_threshold=None)

    def _q(self, sql: str, args: tuple = ()) -> list[dict]:
        with self._lock:
            if self.engine == "sqlite":
                cur = self._conn.execute(sql, args)
                rows = [dict(r) for r in cur.fetchall()]
                self._conn.commit()
                return rows
            import psycopg

            pg_sql = sql.replace("?", "%s")
            for attempt in (1, 2):
                try:
                    cur = self._conn.execute(pg_sql, args)
                    return list(cur.fetchall()) if cur.description else []
                except psycopg.OperationalError:
                    if attempt == 2:
                        raise
                    self._connect_pg()  # the pooler closed an idle connection: reconnect once
            return []

    # --- workspaces --------------------------------------------------------------------------
    def create_project(self, project_id: str, name: str) -> str:
        """Legacy/CLI workspace with a viewer key (returned once)."""
        viewer_key = new_key("vk")
        self._q("INSERT INTO projects (id, name, viewer_key_hash, created_at) VALUES (?,?,?,?)",
                (project_id, name, hash_key(viewer_key), now_iso()))
        return viewer_key

    def create_workspace(self, name: str, user_id: str, email: str) -> str:
        """A signed-in user's workspace; the creator becomes its owner. No viewer key: access is by membership."""
        project_id = f"ws-{secrets.token_hex(5)}"
        self._q("INSERT INTO projects (id, name, created_at) VALUES (?,?,?)", (project_id, name, now_iso()))
        self.add_member(project_id, user_id, email, "owner")
        return project_id

    def create_guest_workspace(self) -> tuple[str, str, str]:
        """(project_id, guest key, expires_at). Deleted with everything in it after GUEST_TTL."""
        self.purge_expired_guests()
        project_id, key = f"guest-{secrets.token_hex(5)}", new_key("gk")
        expires = _iso(datetime.now(timezone.utc) + GUEST_TTL)
        self._q("INSERT INTO projects (id, name, viewer_key_hash, created_at, is_guest, expires_at) VALUES (?,?,?,?,1,?)",
                (project_id, "Guest workspace", hash_key(key), now_iso(), expires))
        return project_id, key, expires

    def purge_expired_guests(self) -> int:
        expired = [r["id"] for r in self._q("SELECT id FROM projects WHERE is_guest = 1 AND expires_at < ?", (now_iso(),))]
        for pid in expired:
            self.delete_project(pid)
        return len(expired)

    def delete_project(self, project_id: str) -> None:
        for table in ("audit_log", "pairing_codes", "invitations", "members", "events", "subscribers", "baselines",
                      "devices"):
            self._q(f"DELETE FROM {table} WHERE project_id = ?", (project_id,))
        self._q("DELETE FROM projects WHERE id = ?", (project_id,))

    def project(self, project_id: str) -> dict | None:
        rows = self._q("SELECT * FROM projects WHERE id = ?", (project_id,))
        p = rows[0] if rows else None
        if p and p.get("is_guest") and p.get("expires_at") and p["expires_at"] < now_iso():
            return None  # expired guest workspaces are gone even before the next purge
        return p

    def ensure_project(self, project_id: str, name: str, viewer_key: str) -> None:
        """Create the project with a GIVEN viewer key, or re-apply that key (startup bootstrap)."""
        if self.project(project_id):
            self._q("UPDATE projects SET viewer_key_hash = ? WHERE id = ?", (hash_key(viewer_key), project_id))
        else:
            self._q("INSERT INTO projects (id, name, viewer_key_hash, created_at) VALUES (?,?,?,?)",
                    (project_id, name, hash_key(viewer_key), now_iso()))

    # --- members & invitations ---------------------------------------------------------------
    def add_member(self, project_id: str, user_id: str, email: str, role: str) -> None:
        if role not in ROLES:
            raise ValueError(f"role must be one of {ROLES}")
        self._q("""INSERT INTO members (project_id, user_id, email, role, created_at) VALUES (?,?,?,?,?)
                   ON CONFLICT (project_id, user_id) DO UPDATE SET role = excluded.role, email = excluded.email""",
                (project_id, user_id, email.lower(), role, now_iso()))

    def member(self, project_id: str, user_id: str) -> dict | None:
        rows = self._q("SELECT * FROM members WHERE project_id = ? AND user_id = ?", (project_id, user_id))
        return rows[0] if rows else None

    def members(self, project_id: str) -> list[dict]:
        return [{**m, "email_alerts": bool(m["email_alerts"])} for m in self._q(
            "SELECT user_id, email, role, created_at, email_alerts FROM members WHERE project_id = ? ORDER BY created_at",
            (project_id,))]

    def set_email_alerts(self, project_id: str, user_id: str, on: bool) -> None:
        self._q("UPDATE members SET email_alerts = ? WHERE project_id = ? AND user_id = ?", (1 if on else 0, project_id, user_id))

    def alert_recipients(self, project_id: str) -> list[dict]:
        """Who gets alert e-mails: every member who has not muted them, plus recipients set up by the admin CLI."""
        out, seen = [], set()
        rows = [{"name": m["email"], "channel": "email", "target": m["email"]}
                for m in self._q("SELECT email FROM members WHERE project_id = ? AND email_alerts = 1", (project_id,))]
        for r in rows + [dict(s) for s in self.subscribers(project_id) if s["channel"] == "email"]:
            if r["target"].lower() not in seen:
                seen.add(r["target"].lower())
                out.append(r)
        return out

    def remove_member(self, project_id: str, user_id: str) -> None:
        self._q("DELETE FROM members WHERE project_id = ? AND user_id = ?", (project_id, user_id))

    def owners(self, project_id: str) -> int:
        return len(self._q("SELECT 1 FROM members WHERE project_id = ? AND role = 'owner'", (project_id,)))

    def invite(self, project_id: str, email: str, role: str, invited_by: str) -> None:
        if role not in ROLES:
            raise ValueError(f"role must be one of {ROLES}")
        self._q("""INSERT INTO invitations (project_id, email, role, invited_by, created_at) VALUES (?,?,?,?,?)
                   ON CONFLICT (project_id, email) DO UPDATE SET role = excluded.role""",
                (project_id, email.lower(), role, invited_by, now_iso()))

    def invitations(self, project_id: str) -> list[dict]:
        return self._q("SELECT email, role, invited_by, created_at FROM invitations WHERE project_id = ?", (project_id,))

    def cancel_invitation(self, project_id: str, email: str) -> None:
        self._q("DELETE FROM invitations WHERE project_id = ? AND email = ?", (project_id, email.lower()))

    def accept_invitations(self, user_id: str, email: str) -> list[str]:
        """Turn pending invitations for this (verified) e-mail into memberships."""
        accepted = []
        for inv in self._q("SELECT project_id, role FROM invitations WHERE email = ?", (email.lower(),)):
            if not self.member(inv["project_id"], user_id):
                self.add_member(inv["project_id"], user_id, email, inv["role"])
            self.cancel_invitation(inv["project_id"], email)
            accepted.append(inv["project_id"])
        return accepted

    def workspaces_for(self, user_id: str) -> list[dict]:
        """The user's workspaces with a live summary for the sidebar (devices, listening now, open alerts)."""
        recent = _iso(datetime.now(timezone.utc) - LISTENING_WINDOW)
        rows = self._q("""SELECT p.id, p.name, m.role, m.email_alerts,
                   (SELECT COUNT(*) FROM devices d WHERE d.project_id = p.id AND d.revoked_at IS NULL
                      AND d.pending = 0) AS devices,
                   (SELECT COUNT(*) FROM devices d WHERE d.project_id = p.id AND d.revoked_at IS NULL
                      AND d.pending = 0 AND d.last_seen_at > ?) AS listening,
                   (SELECT COUNT(*) FROM events e WHERE e.project_id = p.id AND e.ended_at IS NULL) AS open_alerts,
                   (SELECT COUNT(*) FROM members x WHERE x.project_id = p.id) AS members
                 FROM members m JOIN projects p ON p.id = m.project_id
                 WHERE m.user_id = ? ORDER BY p.created_at""", (recent, user_id))
        return [{**r, "email_alerts": bool(r["email_alerts"])} for r in rows]

    # --- devices & pairing -------------------------------------------------------------------
    def create_device(self, project_id: str, name: str, machine_id: str, pending: bool = False) -> tuple[str, str]:
        device_id = f"dev_{secrets.token_hex(4)}"
        device_key = new_key("dk")
        self._q("INSERT INTO devices (id, project_id, name, machine_id, key_hash, created_at, pending) VALUES (?,?,?,?,?,?,?)",
                (device_id, project_id, name, machine_id, hash_key(device_key), now_iso(), 1 if pending else 0))
        return device_id, device_key

    def ensure_device(self, project_id: str, name: str, machine_id: str, device_key: str) -> str:
        """Create a device with a GIVEN key unless it exists (startup bootstrap). Stable id derived from the key."""
        existing = self.device_by_key(project_id, device_key)
        if existing:
            return existing["id"]
        device_id = f"dev_{hash_key(device_key)[:8]}"
        self._q("INSERT INTO devices (id, project_id, name, machine_id, key_hash, created_at) VALUES (?,?,?,?,?,?)",
                (device_id, project_id, name, machine_id, hash_key(device_key), now_iso()))
        return device_id

    def create_pairing_code(self, project_id: str, device_name: str, machine_id: str, created_by: str) -> tuple[str, str]:
        """(code shown once, expires_at). 8 characters from a 32-letter alphabet (40 bits), single use, 10 minutes."""
        code = "".join(secrets.choice(PAIRING_ALPHABET) for _ in range(8))
        expires = _iso(datetime.now(timezone.utc) + PAIRING_TTL)
        self._q("""INSERT INTO pairing_codes (code_hash, project_id, device_name, machine_id, created_by, expires_at)
                   VALUES (?,?,?,?,?,?)""", (hash_key(code), project_id, device_name, machine_id, created_by, expires))
        return f"{code[:4]}-{code[4:]}", expires

    def redeem_pairing_code(self, code: str, device_name: str | None = None) -> dict | None:
        """Single use: marks the code used and creates the device, waiting for an admin to approve it. Returns the
        device with its key (usable once approved), or None."""
        h = hash_key(normalize_code(code))
        rows = self._q("""UPDATE pairing_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?
                          RETURNING project_id, device_name, machine_id, created_by""", (now_iso(), h, now_iso()))
        if not rows or not self.project(rows[0]["project_id"]):
            return None
        r = rows[0]
        name = (device_name or "").strip()[:60] or r["device_name"]
        device_id, key = self.create_device(r["project_id"], name, r["machine_id"], pending=True)
        return {"project_id": r["project_id"], "device_id": device_id, "device_key": key, "device_name": name,
                "machine_id": r["machine_id"], "paired_by": r["created_by"]}

    def approve_device(self, project_id: str, device_id: str) -> dict | None:
        cutoff = _iso(datetime.now(timezone.utc) - APPROVAL_TTL)
        rows = self._q("""UPDATE devices SET pending = 0 WHERE project_id = ? AND id = ? AND pending = 1
                          AND revoked_at IS NULL AND created_at > ? RETURNING id, name""", (project_id, device_id, cutoff))
        return rows[0] if rows else None

    def device_status(self, project_id: str, device_key: str) -> str | None:
        """What a paired device is waiting for: pending | approved | rejected | expired (None: unknown key)."""
        rows = self._q("SELECT pending, revoked_at, created_at FROM devices WHERE project_id = ? AND key_hash = ?",
                       (project_id, hash_key(device_key)))
        if not rows or not self.project(project_id):
            return None
        d = rows[0]
        if d["revoked_at"]:
            return "rejected"
        if d["pending"]:
            return "expired" if d["created_at"] < _iso(datetime.now(timezone.utc) - APPROVAL_TTL) else "pending"
        return "approved"

    def revoke_device(self, project_id: str, device_id: str) -> bool:
        rows = self._q("UPDATE devices SET revoked_at = ? WHERE project_id = ? AND id = ? AND revoked_at IS NULL RETURNING id",
                       (now_iso(), project_id, device_id))
        return bool(rows)

    def device_by_key(self, project_id: str, device_key: str) -> dict | None:
        """An approved, not revoked device (a device waiting for approval cannot send audio yet)."""
        rows = self._q("SELECT * FROM devices WHERE project_id = ? AND key_hash = ? AND revoked_at IS NULL AND pending = 0",
                       (project_id, hash_key(device_key)))
        return rows[0] if rows and self.project(project_id) else None

    def devices(self, project_id: str) -> list[dict]:
        """Approved devices, plus devices waiting for approval (pending: true) that have not expired."""
        cutoff = _iso(datetime.now(timezone.utc) - APPROVAL_TTL)
        rows = self._q("""SELECT d.id, d.name, d.machine_id, d.created_at, d.last_seen_at, d.pending,
                                 b.created_at AS learned_at
                          FROM devices d LEFT JOIN baselines b ON b.device_id = d.id
                          WHERE d.project_id = ? AND d.revoked_at IS NULL AND (d.pending = 0 OR d.created_at > ?)
                          ORDER BY d.name""", (project_id, cutoff))
        return [{**r, "pending": bool(r["pending"])} for r in rows]

    def touch_device(self, device_id: str) -> None:
        self._q("UPDATE devices SET last_seen_at = ? WHERE id = ?", (now_iso(), device_id))

    # --- learned normal sound (on-site baseline per device) ------------------------------------
    def baseline(self, device_id: str) -> dict | None:
        rows = self._q("SELECT * FROM baselines WHERE device_id = ?", (device_id,))
        return rows[0] if rows else None

    def save_baseline(self, project_id: str, device_id: str, machine_id: str, data: str, windows: int) -> None:
        self._q("""INSERT INTO baselines (device_id, project_id, machine_id, data, windows, created_at) VALUES (?,?,?,?,?,?)
                   ON CONFLICT (device_id) DO UPDATE SET data = excluded.data, windows = excluded.windows,
                   machine_id = excluded.machine_id, created_at = excluded.created_at""",
                (device_id, project_id, machine_id, data, windows, now_iso()))

    def delete_baseline(self, device_id: str) -> None:
        self._q("DELETE FROM baselines WHERE device_id = ?", (device_id,))

    # --- subscribers ---------------------------------------------------------------------------
    def ensure_subscriber(self, project_id: str, name: str, channel: str, target: str) -> None:
        if not self._q("SELECT 1 FROM subscribers WHERE project_id = ? AND channel = ? AND target = ?",
                       (project_id, channel, target)):
            self.add_subscriber(project_id, name, channel, target)

    def add_subscriber(self, project_id: str, name: str, channel: str, target: str) -> None:
        if channel not in CHANNELS:
            raise ValueError(f"channel must be one of {CHANNELS}")
        self._q("INSERT INTO subscribers (project_id, name, channel, target, created_at) VALUES (?,?,?,?,?)",
                (project_id, name, channel, target, now_iso()))

    def subscribers(self, project_id: str) -> list[dict]:
        return self._q("SELECT * FROM subscribers WHERE project_id = ?", (project_id,))

    def remove_subscriber(self, project_id: str, subscriber_id: int) -> None:
        self._q("DELETE FROM subscribers WHERE project_id = ? AND id = ?", (project_id, subscriber_id))

    # --- audit -----------------------------------------------------------------------------------
    def audit(self, project_id: str, actor: str, action: str, detail: str | None = None) -> None:
        self._q("INSERT INTO audit_log (project_id, actor, action, detail, at) VALUES (?,?,?,?,?)",
                (project_id, actor, action, detail, now_iso()))

    def audit_log(self, project_id: str, limit: int = 100) -> list[dict]:
        return self._q("SELECT actor, action, detail, at FROM audit_log WHERE project_id = ? ORDER BY at DESC LIMIT ?",
                       (project_id, limit))

    # --- events ------------------------------------------------------------------------------
    def upsert_event(self, project_id: str, device_id: str, ev: AlertEvent, interference_note: str | None = None) -> None:
        """`interference_note` is recorded when the event opens and kept for its lifetime."""
        e = asdict(ev)
        self._q(
            """INSERT INTO events (event_id, project_id, device_id, session_id, machine_id, started_at,
                 last_anomalous_at, ended_at, anomalous_window_count, peak_score, threshold, reason, acknowledged_at,
                 interference_note)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT (event_id) DO UPDATE SET last_anomalous_at = excluded.last_anomalous_at,
                 ended_at = excluded.ended_at, anomalous_window_count = excluded.anomalous_window_count,
                 peak_score = excluded.peak_score""",
            (e["event_id"], project_id, device_id, e["session_id"], e["machine_id"], e["started_at"],
             e["last_anomalous_at"], e["ended_at"], e["anomalous_window_count"], e["peak_score"], e["threshold"],
             e["reason"], e["acknowledged_at"], interference_note))

    def events(self, project_id: str, session_id: str | None = None, limit: int = 100) -> list[dict]:
        sql = "SELECT * FROM events WHERE project_id = ?" + (" AND session_id = ?" if session_id else "")
        args = (project_id, session_id) if session_id else (project_id,)
        return self._q(sql + " ORDER BY started_at DESC LIMIT ?", (*args, limit))

    def event(self, project_id: str, event_id: str) -> dict | None:
        rows = self._q("SELECT * FROM events WHERE project_id = ? AND event_id = ?", (project_id, event_id))
        return rows[0] if rows else None

    def acknowledge(self, project_id: str, event_id: str, by: str | None = None) -> dict | None:
        self._q("""UPDATE events SET acknowledged_at = COALESCE(acknowledged_at, ?),
                     acknowledged_by = COALESCE(acknowledged_by, ?) WHERE project_id = ? AND event_id = ?""",
                (now_iso(), by, project_id, event_id))
        return self.event(project_id, event_id)


def _statements(script: str) -> list[str]:
    return [s.strip() for s in script.split(";") if s.strip()]
