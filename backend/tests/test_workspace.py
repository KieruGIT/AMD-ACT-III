"""Accounts: guest mode, workspaces, invitations and roles, device pairing, e-mail recipients, audit."""
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import app.routers.workspace as workspace
from app.auth import User
from app.main import create_app

USERS = {"t-alice": User("u-alice", "alice@example.com"), "t-bob": User("u-bob", "bob@example.com"),
         "t-carol": User("u-carol", "carol@example.com")}


def fake_verify(token: str) -> User:
    if token not in USERS:
        raise HTTPException(401, "invalid session token")
    return USERS[token]


@pytest.fixture
def c(monkeypatch):
    sent = []

    async def no_mail(*args, **kwargs):
        sent.append(args)
        return True

    monkeypatch.setattr(workspace, "send_invitation", no_mail)
    workspace._pair_fails.clear()
    app = create_app(":memory:")
    app.state.verify_token = fake_verify
    client = TestClient(app)
    client.invites_sent = sent
    return client


def as_(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def workspace_of(c, token="t-alice", name="Plant A") -> str:
    r = c.post("/api/v1/workspaces", json={"name": name}, headers=as_(token))
    assert r.status_code == 200 and r.json()["role"] == "owner"
    return r.json()["id"]


def test_sign_in_is_required_and_bad_tokens_are_rejected(c):
    assert c.get("/api/v1/me").status_code == 401
    assert c.get("/api/v1/me", headers=as_("t-nobody")).status_code == 401
    me = c.get("/api/v1/me", headers=as_("t-alice")).json()
    assert me["user"]["email"] == "alice@example.com" and me["workspaces"] == []


def test_workspace_is_private_to_members(c):
    pid = workspace_of(c)
    assert c.get("/api/v1/me", headers=as_("t-alice")).json()["workspaces"][0]["id"] == pid
    ov = c.get(f"/api/v1/projects/{pid}", headers=as_("t-alice")).json()
    assert ov["role"] == "owner" and ov["access"] == "user" and ov["is_guest"] is False
    assert c.get(f"/api/v1/projects/{pid}", headers=as_("t-bob")).status_code == 403
    assert c.get(f"/api/v1/projects/{pid}").status_code == 401


def test_invitation_becomes_membership_on_sign_in_with_least_privilege(c):
    pid = workspace_of(c)
    r = c.post(f"/api/v1/projects/{pid}/invitations", json={"email": "Bob@Example.com", "role": "viewer"}, headers=as_("t-alice"))
    assert r.status_code == 200 and r.json()["email"] == "bob@example.com"
    assert c.invites_sent and c.invites_sent[0][0] == "bob@example.com"  # invitation e-mail queued
    assert c.get(f"/api/v1/projects/{pid}/members", headers=as_("t-alice")).json()["invitations"][0]["email"] == "bob@example.com"

    ws = c.get("/api/v1/me", headers=as_("t-bob")).json()["workspaces"]
    assert ws == [{"id": pid, "name": "Plant A", "role": "viewer"}]
    assert c.get(f"/api/v1/projects/{pid}", headers=as_("t-bob")).status_code == 200  # viewers watch
    # ...but cannot manage
    assert c.post(f"/api/v1/projects/{pid}/pairing-codes", json={"device_name": "x"}, headers=as_("t-bob")).status_code == 403
    assert c.post(f"/api/v1/projects/{pid}/invitations", json={"email": "c@example.com"}, headers=as_("t-bob")).status_code == 403
    assert c.get(f"/api/v1/projects/{pid}/audit", headers=as_("t-bob")).status_code == 403


def test_roles_cannot_escalate_and_the_last_owner_stays(c):
    pid = workspace_of(c)
    c.post(f"/api/v1/projects/{pid}/invitations", json={"email": "bob@example.com", "role": "admin"}, headers=as_("t-alice"))
    c.get("/api/v1/me", headers=as_("t-bob"))
    r = c.post(f"/api/v1/projects/{pid}/invitations", json={"email": "carol@example.com", "role": "owner"}, headers=as_("t-bob"))
    assert r.status_code == 403  # admins cannot grant owner
    assert c.patch(f"/api/v1/projects/{pid}/members/u-alice", json={"role": "viewer"}, headers=as_("t-bob")).status_code == 403
    assert c.patch(f"/api/v1/projects/{pid}/members/u-alice", json={"role": "viewer"}, headers=as_("t-alice")).status_code == 409
    assert c.delete(f"/api/v1/projects/{pid}/members/u-alice", headers=as_("t-bob")).status_code == 403
    assert c.patch(f"/api/v1/projects/{pid}/members/u-bob", json={"role": "viewer"}, headers=as_("t-alice")).status_code == 200
    assert c.delete(f"/api/v1/projects/{pid}/members/u-bob", headers=as_("t-bob")).status_code == 200  # anyone may leave
    assert c.get(f"/api/v1/projects/{pid}", headers=as_("t-bob")).status_code == 403


def test_pairing_code_is_single_use_and_revocation_cuts_the_device_off(c):
    pid = workspace_of(c)
    code = c.post(f"/api/v1/projects/{pid}/pairing-codes", json={"device_name": "Phone at fan"}, headers=as_("t-alice")).json()
    assert len(code["code"]) == 9 and code["machine_id"] == "fan_01"
    paired = c.post("/api/v1/pair", json={"code": code["code"].lower().replace("-", "")}).json()  # typing-friendly
    assert paired["project_id"] == pid and paired["device_key"].startswith("dk_") and paired["project_name"] == "Plant A"
    assert c.post("/api/v1/pair", json={"code": code["code"]}).status_code == 404  # used up

    db = c.app.state.db
    assert db.device_by_key(pid, paired["device_key"])["name"] == "Phone at fan"
    assert c.post(f"/api/v1/projects/{pid}/devices/{paired['device_id']}/revoke", headers=as_("t-alice")).status_code == 200
    assert db.device_by_key(pid, paired["device_key"]) is None
    assert c.post(f"/api/v1/projects/{pid}/devices/{paired['device_id']}/revoke", headers=as_("t-alice")).status_code == 404
    log = [e["action"] for e in c.get(f"/api/v1/projects/{pid}/audit", headers=as_("t-alice")).json()]
    assert {"device.pairing_code_created", "device.paired", "device.revoked"} <= set(log)


def test_wrong_codes_are_rate_limited(c):
    for _ in range(workspace.PAIR_FAILS_PER_10_MIN):
        assert c.post("/api/v1/pair", json={"code": "ZZZZ-ZZZZ"}).status_code == 404
    assert c.post("/api/v1/pair", json={"code": "ZZZZ-ZZZZ"}).status_code == 429


def test_guest_workspace_is_temporary_and_cannot_invite(c):
    g = c.post("/api/v1/guest").json()
    h = {"X-Guest-Key": g["guest_key"]}
    ov = c.get(f"/api/v1/projects/{g['project_id']}", headers=h).json()
    assert ov["is_guest"] is True and ov["role"] == "owner" and ov["expires_at"] == g["expires_at"]
    assert c.post(f"/api/v1/projects/{g['project_id']}/pairing-codes", json={"device_name": "Laptop"}, headers=h).status_code == 200
    assert c.post(f"/api/v1/projects/{g['project_id']}/invitations", json={"email": "x@example.com"}, headers=h).status_code == 403
    assert c.get(f"/api/v1/projects/{g['project_id']}", headers={"X-Guest-Key": "gk_wrong"}).status_code == 403

    db = c.app.state.db
    db._q("UPDATE projects SET expires_at = ? WHERE id = ?", ("2000-01-01T00:00:00+00:00", g["project_id"]))
    assert c.get(f"/api/v1/projects/{g['project_id']}", headers=h).status_code == 403  # expired = gone
    db.purge_expired_guests()
    assert db._q("SELECT id FROM projects WHERE id = ?", (g["project_id"],)) == []


def test_alert_recipients_are_email_only(c):
    pid = workspace_of(c)
    url = f"/api/v1/projects/{pid}/subscribers"
    assert c.post(url, json={"name": "Ops", "email": "not-an-email"}, headers=as_("t-alice")).status_code == 422
    assert c.post(url, json={"name": "Ops", "email": "Ops@Example.com"}, headers=as_("t-alice")).status_code == 200
    subs = c.get(url, headers=as_("t-alice")).json()
    assert subs == [{"id": subs[0]["id"], "name": "Ops", "email": "ops@example.com"}]
    assert c.delete(f"{url}/{subs[0]['id']}", headers=as_("t-alice")).status_code == 200
    assert c.get(url, headers=as_("t-alice")).json() == []
