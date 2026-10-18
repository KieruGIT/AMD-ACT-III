"""Accounts and administration: guest mode, my workspaces, members/invitations, device pairing, my alert e-mails,
audit.

Alert e-mails go to every member of a workspace (at the address they sign in with) unless they mute them for
themselves; there is no separate recipients list. Roles: owner (everything, incl. owners), admin (devices, members
except owners), viewer (watch and acknowledge). Every change is written to the workspace audit log.
"""
from __future__ import annotations

import re
import time
from collections import defaultdict, deque

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request
from pydantic import BaseModel, Field

from ..auth import RANK, Principal, principal, require_user
from ..db import ROLES
from ..notify import send_invitation
from ..profiles import PROFILES

router = APIRouter(prefix="/api/v1")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PAIR_FAILS_PER_10_MIN = 10
_pair_fails: dict[str, deque] = defaultdict(deque)


def _caller(request: Request, project_id: str, min_role: str, authorization: str | None, x_guest_key: str | None,
            x_viewer_key: str | None = None) -> Principal:
    return principal(request, project_id, authorization=authorization, guest_key=x_guest_key, viewer_key=x_viewer_key,
                     min_role=min_role)


# --- guest mode -------------------------------------------------------------------------------------
@router.post("/guest")
def start_guest(request: Request):
    """A temporary workspace for trying the product without an account. Nothing is kept: it is deleted after 2 h."""
    pid, key, expires = request.app.state.db.create_guest_workspace()
    return {"project_id": pid, "guest_key": key, "expires_at": expires}


# --- me ---------------------------------------------------------------------------------------------
@router.get("/me")
def me(request: Request, authorization: str | None = Header(None)):
    user = require_user(request, authorization)
    db = request.app.state.db
    db.accept_invitations(user.id, user.email)  # pending invitations become memberships on sign-in
    return {"user": {"id": user.id, "email": user.email}, "workspaces": db.workspaces_for(user.id)}


class NewWorkspace(BaseModel):
    name: str = Field(min_length=2, max_length=60)


@router.post("/workspaces")
def create_workspace(body: NewWorkspace, request: Request, authorization: str | None = Header(None)):
    user = require_user(request, authorization)
    db = request.app.state.db
    pid = db.create_workspace(body.name.strip(), user.id, user.email)
    db.audit(pid, user.email, "workspace.created", body.name.strip())
    return {"id": pid, "name": body.name.strip(), "role": "owner"}


class Rename(BaseModel):
    name: str = Field(min_length=2, max_length=60)


@router.patch("/projects/{project_id}")
def rename_workspace(project_id: str, body: Rename, request: Request, authorization: str | None = Header(None),
                     x_guest_key: str | None = Header(None)):
    p = _caller(request, project_id, "owner", authorization, x_guest_key)
    db = request.app.state.db
    old = db.project(project_id)["name"]
    db.rename_project(project_id, body.name.strip())
    db.audit(project_id, p.actor, "workspace.renamed", f"{old} → {body.name.strip()}")
    return {"id": project_id, "name": body.name.strip()}


@router.delete("/projects/{project_id}")
def delete_workspace(project_id: str, request: Request, authorization: str | None = Header(None),
                     x_guest_key: str | None = Header(None)):
    """Deletes the workspace with its devices, alert history, members and log. Owners only; cannot be undone."""
    _caller(request, project_id, "owner", authorization, x_guest_key)
    request.app.state.db.delete_project(project_id)
    return {"ok": True}


# --- members & invitations ----------------------------------------------------------------------------
@router.get("/projects/{project_id}/members")
def list_members(project_id: str, request: Request, authorization: str | None = Header(None),
                 x_guest_key: str | None = Header(None)):
    _caller(request, project_id, "viewer", authorization, x_guest_key)
    db = request.app.state.db
    return {"members": db.members(project_id), "invitations": db.invitations(project_id)}


class Invite(BaseModel):
    email: str
    role: str = "viewer"


@router.post("/projects/{project_id}/invitations")
def invite(project_id: str, body: Invite, request: Request, background: BackgroundTasks,
           authorization: str | None = Header(None), x_guest_key: str | None = Header(None)):
    p = _caller(request, project_id, "admin", authorization, x_guest_key)
    if p.kind == "guest":
        raise HTTPException(403, "guest workspaces cannot invite people; create an account")
    if not EMAIL.match(body.email.strip()) or body.role not in ROLES:
        raise HTTPException(422, f"need a valid e-mail and a role in {ROLES}")
    if RANK[body.role] > RANK[p.role]:
        raise HTTPException(403, "you cannot grant a role above your own")
    db = request.app.state.db
    db.invite(project_id, body.email.strip(), body.role, p.actor)
    email = body.email.strip().lower()
    db.audit(project_id, p.actor, "member.invited", f"{email} as {body.role}")
    background.add_task(send_invitation, email, db.project(project_id)["name"], body.role, p.actor)
    return {"email": email, "role": body.role}


@router.delete("/projects/{project_id}/invitations/{email}")
def cancel_invite(project_id: str, email: str, request: Request, authorization: str | None = Header(None),
                  x_guest_key: str | None = Header(None)):
    p = _caller(request, project_id, "admin", authorization, x_guest_key)
    request.app.state.db.cancel_invitation(project_id, email)
    request.app.state.db.audit(project_id, p.actor, "member.invitation_cancelled", email.lower())
    return {"ok": True}


class RoleChange(BaseModel):
    role: str


@router.patch("/projects/{project_id}/members/{user_id}")
def change_role(project_id: str, user_id: str, body: RoleChange, request: Request,
                authorization: str | None = Header(None)):
    p = _caller(request, project_id, "owner", authorization, None)
    db = request.app.state.db
    m = db.member(project_id, user_id)
    if not m or body.role not in ROLES:
        raise HTTPException(404 if not m else 422, "member not found" if not m else f"role must be one of {ROLES}")
    if m["role"] == "owner" and body.role != "owner" and db.owners(project_id) == 1:
        raise HTTPException(409, "a workspace needs at least one owner")
    db.add_member(project_id, user_id, m["email"], body.role)
    db.audit(project_id, p.actor, "member.role_changed", f"{m['email']}: {m['role']} → {body.role}")
    return {"user_id": user_id, "role": body.role}


@router.delete("/projects/{project_id}/members/{user_id}")
def remove_member(project_id: str, user_id: str, request: Request, authorization: str | None = Header(None)):
    p = _caller(request, project_id, "viewer", authorization, None)
    db = request.app.state.db
    m = db.member(project_id, user_id)
    if not m:
        raise HTTPException(404, "member not found")
    leaving = p.user_id == user_id
    if not leaving and (not p.at_least("admin") or (m["role"] == "owner" and p.role != "owner")):
        raise HTTPException(403, "only owners remove owners; admins remove admins and viewers")
    if m["role"] == "owner" and db.owners(project_id) == 1:
        raise HTTPException(409, "a workspace needs at least one owner")
    db.remove_member(project_id, user_id)
    db.audit(project_id, p.actor, "member.left" if leaving else "member.removed", m["email"])
    return {"ok": True}


# --- devices & pairing ------------------------------------------------------------------------------------
class NewPairing(BaseModel):
    device_name: str = Field(min_length=1, max_length=60)
    machine_id: str = "fan_01"


@router.post("/projects/{project_id}/pairing-codes")
def pairing_code(project_id: str, body: NewPairing, request: Request, authorization: str | None = Header(None),
                 x_guest_key: str | None = Header(None)):
    """One-time code (10 min) that a phone or sensor enters once to become a listening device of this workspace."""
    p = _caller(request, project_id, "admin", authorization, x_guest_key)
    if body.machine_id not in PROFILES:
        raise HTTPException(422, f"machine_id: unsupported profile {body.machine_id}")
    db = request.app.state.db
    code, expires = db.create_pairing_code(project_id, body.device_name.strip(), body.machine_id, p.actor)
    db.audit(project_id, p.actor, "device.pairing_code_created", body.device_name.strip())
    return {"code": code, "expires_at": expires, "device_name": body.device_name.strip(), "machine_id": body.machine_id}


class Pair(BaseModel):
    code: str = Field(min_length=6, max_length=20)
    device_name: str | None = Field(None, max_length=60)  # what the device calls itself, e.g. "iPhone · Safari"


@router.post("/pair")
def pair(body: Pair, request: Request):
    """Redeem a pairing code. Returns the device credential ONCE; the device keeps it (never in a URL). The device can
    send audio only after an admin of the workspace approves it (GET /pair/status tells it when)."""
    ip = request.client.host if request.client else "?"
    fails, now = _pair_fails[ip], time.time()
    while fails and fails[0] < now - 600:
        fails.popleft()
    if len(fails) >= PAIR_FAILS_PER_10_MIN:
        raise HTTPException(429, "too many wrong codes; wait a few minutes")
    db = request.app.state.db
    d = db.redeem_pairing_code(body.code, body.device_name)
    if not d:
        fails.append(now)
        raise HTTPException(404, "code not found, already used or expired")
    project = db.project(d["project_id"])
    db.audit(d["project_id"], d["paired_by"], "device.requested", d["device_name"])
    request.app.state.hub.publish(d["project_id"], {"type": "device_request", "device_id": d["device_id"],
                                                   "device_name": d["device_name"]})
    return {**d, "status": "pending", "project_name": project["name"], "is_guest": bool(project.get("is_guest"))}


@router.get("/pair/status")
def pair_status(request: Request, x_project_id: str | None = Header(None), x_device_key: str | None = Header(None)):
    """A paired device asks whether an admin has approved it: pending | approved | rejected | expired."""
    if not x_project_id or not x_device_key:
        raise HTTPException(401, "X-Project-Id and X-Device-Key headers are required")
    status = request.app.state.db.device_status(x_project_id, x_device_key)
    if status is None:
        raise HTTPException(404, "unknown device")
    return {"status": status}


@router.post("/projects/{project_id}/devices/{device_id}/approve")
def approve(project_id: str, device_id: str, request: Request, authorization: str | None = Header(None),
            x_guest_key: str | None = Header(None)):
    p = _caller(request, project_id, "admin", authorization, x_guest_key)
    db = request.app.state.db
    d = db.approve_device(project_id, device_id)
    if not d:
        raise HTTPException(404, "no device waiting for approval (expired, rejected or already approved)")
    db.audit(project_id, p.actor, "device.paired", f"{d['name']} ({device_id})")
    request.app.state.hub.publish(project_id, {"type": "device_approved", "device_id": device_id})
    return {"ok": True}


@router.post("/projects/{project_id}/devices/{device_id}/relearn")
def relearn(project_id: str, device_id: str, request: Request, authorization: str | None = Header(None),
            x_guest_key: str | None = Header(None)):
    """Forget a device's learned normal sound; it learns again from the next minute of listening."""
    p = _caller(request, project_id, "admin", authorization, x_guest_key)
    db = request.app.state.db
    if not any(d["id"] == device_id and not d["pending"] for d in db.devices(project_id)):
        raise HTTPException(404, "device not found")
    db.delete_baseline(device_id)
    request.app.state.hub.forget_device(device_id)
    db.audit(project_id, p.actor, "device.relearn", device_id)
    request.app.state.hub.publish(project_id, {"type": "device_relearn", "device_id": device_id})
    return {"ok": True}


@router.post("/projects/{project_id}/devices/{device_id}/revoke")
def revoke(project_id: str, device_id: str, request: Request, authorization: str | None = Header(None),
           x_guest_key: str | None = Header(None)):
    p = _caller(request, project_id, "admin", authorization, x_guest_key)
    db = request.app.state.db
    pending = any(d["id"] == device_id and d["pending"] for d in db.devices(project_id))
    if not db.revoke_device(project_id, device_id):
        raise HTTPException(404, "device not found or already revoked")
    db.audit(project_id, p.actor, "device.rejected" if pending else "device.revoked", device_id)
    request.app.state.hub.publish(project_id, {"type": "device_revoked", "device_id": device_id})
    return {"ok": True}


# --- my alert e-mails ----------------------------------------------------------------------------------------
class AlertPrefs(BaseModel):
    email_alerts: bool


@router.patch("/projects/{project_id}/me")
def my_alert_emails(project_id: str, body: AlertPrefs, request: Request, authorization: str | None = Header(None)):
    """Each member turns alert e-mails on or off for themselves."""
    p = _caller(request, project_id, "viewer", authorization, None)
    if p.kind != "user":
        raise HTTPException(403, "alert e-mails are for signed-in members")
    db = request.app.state.db
    db.set_email_alerts(project_id, p.user_id, body.email_alerts)
    db.audit(project_id, p.actor, "alerts.email_on" if body.email_alerts else "alerts.email_off")
    return {"email_alerts": body.email_alerts}


# --- audit ----------------------------------------------------------------------------------------------------
@router.get("/projects/{project_id}/audit")
def audit_log(project_id: str, request: Request, authorization: str | None = Header(None),
              x_guest_key: str | None = Header(None)):
    _caller(request, project_id, "admin", authorization, x_guest_key)
    return request.app.state.db.audit_log(project_id)
