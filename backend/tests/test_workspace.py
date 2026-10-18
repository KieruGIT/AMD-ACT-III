"""Accounts: guest mode, workspaces, invitations and roles, device pairing, member alert e-mails, audit."""
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
    assert [(w["id"], w["name"], w["role"]) for w in ws] == [(pid, "Plant A", "viewer")]
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
    assert paired["status"] == "pending"
    assert c.post("/api/v1/pair", json={"code": code["code"]}).status_code == 404  # used up

    # it waits for an admin: no audio until approved
    db = c.app.state.db
    dev = {"X-Project-Id": pid, "X-Device-Key": paired["device_key"]}
    assert db.device_by_key(pid, paired["device_key"]) is None
    assert c.get("/api/v1/pair/status", headers=dev).json() == {"status": "pending"}
    listed = c.get(f"/api/v1/projects/{pid}", headers=as_("t-alice")).json()["devices"]
    assert [(d["name"], d["pending"]) for d in listed] == [("Phone at fan", True)]
    url = f"/api/v1/projects/{pid}/devices/{paired['device_id']}"
    assert c.post(f"{url}/approve", headers=as_("t-alice")).status_code == 200
    assert c.post(f"{url}/approve", headers=as_("t-alice")).status_code == 404  # once
    assert c.get("/api/v1/pair/status", headers=dev).json() == {"status": "approved"}
    assert db.device_by_key(pid, paired["device_key"])["name"] == "Phone at fan"
    assert c.post(f"/api/v1/projects/{pid}/devices/{paired['device_id']}/revoke", headers=as_("t-alice")).status_code == 200
    assert db.device_by_key(pid, paired["device_key"]) is None
    assert c.post(f"/api/v1/projects/{pid}/devices/{paired['device_id']}/revoke", headers=as_("t-alice")).status_code == 404
    log = [e["action"] for e in c.get(f"/api/v1/projects/{pid}/audit", headers=as_("t-alice")).json()]

    assert {"device.pairing_code_created", "device.requested", "device.paired", "device.revoked"} <= set(log)
    assert c.get("/api/v1/pair/status", headers=dev).json() == {"status": "rejected"}


def test_device_can_name_itself_and_admins_reject_or_relearn(c):
    pid = workspace_of(c)
    url = f"/api/v1/projects/{pid}"
    code = c.post(f"{url}/pairing-codes", json={"device_name": "Device 1"}, headers=as_("t-alice")).json()
    paired = c.post("/api/v1/pair", json={"code": code["code"], "device_name": "iPhone · Safari"}).json()
    assert paired["device_name"] == "iPhone · Safari"
    c.post(f"{url}/invitations", json={"email": "bob@example.com", "role": "viewer"}, headers=as_("t-alice"))
    c.get("/api/v1/me", headers=as_("t-bob"))
    assert c.post(f"{url}/devices/{paired['device_id']}/approve", headers=as_("t-bob")).status_code == 403  # viewers can't
    assert c.post(f"{url}/devices/{paired['device_id']}/revoke", headers=as_("t-alice")).status_code == 200  # reject
    assert c.get("/api/v1/pair/status", headers={"X-Project-Id": pid, "X-Device-Key": paired["device_key"]}).json() == {"status": "rejected"}
    assert c.get(url, headers=as_("t-alice")).json()["devices"] == []

    # re-learn: forget the learned normal of an approved device
    code = c.post(f"{url}/pairing-codes", json={"device_name": "Sensor"}, headers=as_("t-alice")).json()
    d = c.post("/api/v1/pair", json={"code": code["code"]}).json()
    c.post(f"{url}/devices/{d['device_id']}/approve", headers=as_("t-alice"))
    db = c.app.state.db
    db.save_baseline(pid, d["device_id"], "fan_01", "{}", 60)
    assert c.get(url, headers=as_("t-alice")).json()["devices"][0]["learned_at"]
    assert c.post(f"{url}/devices/{d['device_id']}/relearn", headers=as_("t-alice")).status_code == 200
    assert db.baseline(d["device_id"]) is None
    assert "device.relearn" in [e["action"] for e in c.get(f"{url}/audit", headers=as_("t-alice")).json()]


def test_wrong_codes_are_rate_limited(c):
    for _ in range(workspace.PAIR_FAILS_PER_10_MIN):
        assert c.post("/api/v1/pair", json={"code": "ZZZZ-ZZZZ"}).status_code == 404
    assert c.post("/api/v1/pair", json={"code": "ZZZZ-ZZZZ"}).status_code == 429


def test_guest_workspace_is_temporary_and_cannot_invite(c):
    g = c.post("/api/v1/guest", json={"name": "Garage"}).json()
    h = {"X-Guest-Key": g["guest_key"]}
    ov = c.get(f"/api/v1/projects/{g['project_id']}", headers=h).json()
    assert ov["name"] == "Garage" and g["name"] == "Garage"
    assert c.post("/api/v1/guest", json={"name": "x"}).status_code == 422
    assert ov["is_guest"] is True and ov["role"] == "owner" and ov["expires_at"] == g["expires_at"]
    assert c.post(f"/api/v1/projects/{g['project_id']}/pairing-codes", json={"device_name": "Laptop"}, headers=h).status_code == 200
    assert c.post(f"/api/v1/projects/{g['project_id']}/invitations", json={"email": "x@example.com"}, headers=h).status_code == 403
    assert c.get(f"/api/v1/projects/{g['project_id']}", headers={"X-Guest-Key": "gk_wrong"}).status_code == 403

    db = c.app.state.db
    db._q("UPDATE projects SET expires_at = ? WHERE id = ?", ("2000-01-01T00:00:00+00:00", g["project_id"]))
    assert c.get(f"/api/v1/projects/{g['project_id']}", headers=h).status_code == 403  # expired = gone
    db.purge_expired_guests()
    assert db._q("SELECT id FROM projects WHERE id = ?", (g["project_id"],)) == []


def test_alert_emails_go_to_members_who_have_not_muted_them(c):
    pid = workspace_of(c)
    c.post(f"/api/v1/projects/{pid}/invitations", json={"email": "bob@example.com", "role": "viewer"}, headers=as_("t-alice"))
    db = c.app.state.db
    assert [r["target"] for r in db.alert_recipients(pid)] == ["alice@example.com"]  # invited, not yet joined
    c.get("/api/v1/me", headers=as_("t-bob"))  # bob signs in and joins
    assert [r["target"] for r in db.alert_recipients(pid)] == ["alice@example.com", "bob@example.com"]

    # each member mutes only themselves
    r = c.patch(f"/api/v1/projects/{pid}/me", json={"email_alerts": False}, headers=as_("t-bob"))
    assert r.status_code == 200 and r.json() == {"email_alerts": False}
    assert [r["target"] for r in db.alert_recipients(pid)] == ["alice@example.com"]
    members = {m["email"]: m["email_alerts"] for m in c.get(f"/api/v1/projects/{pid}/members", headers=as_("t-alice")).json()["members"]}
    assert members == {"alice@example.com": True, "bob@example.com": False}
    assert c.get("/api/v1/me", headers=as_("t-bob")).json()["workspaces"][0]["email_alerts"] is False

    # guests have no e-mail address to mute; strangers cannot touch it
    g = c.post("/api/v1/guest").json()
    assert c.patch(f"/api/v1/projects/{g['project_id']}/me", json={"email_alerts": False},
                   headers={"X-Guest-Key": g["guest_key"]}).status_code in (401, 403)
    assert c.patch(f"/api/v1/projects/{pid}/me", json={"email_alerts": True}, headers=as_("t-carol")).status_code == 403
    assert c.get(f"/api/v1/projects/{pid}/subscribers", headers=as_("t-alice")).status_code == 404  # no manual list any more


def test_sidebar_summary_counts_devices_listening_and_open_alerts(c):
    pid = workspace_of(c)
    code = c.post(f"/api/v1/projects/{pid}/pairing-codes", json={"device_name": "Phone"}, headers=as_("t-alice")).json()
    paired = c.post("/api/v1/pair", json={"code": code["code"]}).json()
    assert c.get("/api/v1/me", headers=as_("t-alice")).json()["workspaces"][0]["devices"] == 0  # not until approved
    c.post(f"/api/v1/projects/{pid}/devices/{paired['device_id']}/approve", headers=as_("t-alice"))
    w = c.get("/api/v1/me", headers=as_("t-alice")).json()["workspaces"][0]
    assert (w["devices"], w["listening"], w["open_alerts"], w["members"]) == (1, 0, 0, 1)
    c.app.state.db.touch_device(paired["device_id"])
    assert c.get("/api/v1/me", headers=as_("t-alice")).json()["workspaces"][0]["listening"] == 1


def test_owners_rename_and_delete_a_workspace(c):
    pid = workspace_of(c)
    c.post(f"/api/v1/projects/{pid}/invitations", json={"email": "bob@example.com", "role": "admin"}, headers=as_("t-alice"))
    c.get("/api/v1/me", headers=as_("t-bob"))
    assert c.patch(f"/api/v1/projects/{pid}", json={"name": "Plant B"}, headers=as_("t-bob")).status_code == 403  # editors can't
    assert c.patch(f"/api/v1/projects/{pid}", json={"name": "Plant B"}, headers=as_("t-alice")).json()["name"] == "Plant B"
    assert c.get("/api/v1/me", headers=as_("t-alice")).json()["workspaces"][0]["name"] == "Plant B"
    assert c.delete(f"/api/v1/projects/{pid}", headers=as_("t-bob")).status_code == 403
    assert c.delete(f"/api/v1/projects/{pid}", headers=as_("t-alice")).status_code == 200
    assert c.get("/api/v1/me", headers=as_("t-alice")).json()["workspaces"] == []
    assert c.get("/api/v1/me", headers=as_("t-bob")).json()["workspaces"] == []
