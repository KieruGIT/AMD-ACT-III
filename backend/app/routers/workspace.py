"""Accounts and administration: guest mode, my workspaces, members/invitations, device pairing, alert recipients, audit.

Roles: owner (everything, incl. owners), admin (devices, members except owners, alert recipients), viewer (watch and
acknowledge). Every change is written to the workspace audit log.
"""
from __future__ import annotations

import re
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from ..auth import RANK, Principal, principal, require_user
from ..db import CHANNELS, ROLES
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
def invite(project_id: str, body: Invite, request: Request, authorization: str | None = Header(None),
           x_guest_key: str | None = Header(None)):
    p = _caller(request, project_id, "admin", authorization, x_guest_key)
    if p.kind == "guest":
        raise HTTPException(403, "guest workspaces cannot invite people; create an account")
    if not EMAIL.match(body.email.strip()) or body.role not in ROLES:
        raise HTTPException(422, f"need a valid e-mail and a role in {ROLES}")
    if RANK[body.role] > RANK[p.role]:
        raise HTTPException(403, "you cannot grant a role above your own")
    db = request.app.state.db
    db.invite(project_id, body.email.strip(), body.role, p.actor)
    db.audit(project_id, p.actor, "member.invited", f"{body.email.strip().lower()} as {body.role}")
    return {"email": body.email.strip().lower(), "role": body.role}


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


@router.post("/pair")
def pair(body: Pair, request: Request):
    """Redeem a pairing code. Returns the device credential ONCE; the device keeps it (never in a URL)."""
    ip = request.client.host if request.client else "?"
    fails, now = _pair_fails[ip], time.time()
    while fails and fails[0] < now - 600:
        fails.popleft()
    if len(fails) >= PAIR_FAILS_PER_10_MIN:
        raise HTTPException(429, "too many wrong codes; wait a few minutes")
    db = request.app.state.db
    d = db.redeem_pairing_code(body.code)
    if not d:
        fails.append(now)
        raise HTTPException(404, "code not found, already used or expired")
    project = db.project(d["project_id"])
    db.audit(d["project_id"], d["paired_by"], "device.paired", f"{d['device_name']} ({d['device_id']})")
    return {**d, "project_name": project["name"], "is_guest": bool(project.get("is_guest"))}


@router.post("/projects/{project_id}/devices/{device_id}/revoke")
def revoke(project_id: str, device_id: str, request: Request, authorization: str | None = Header(None),
           x_guest_key: str | None = Header(None)):
    p = _caller(request, project_id, "admin", authorization, x_guest_key)
    db = request.app.state.db
    if not db.revoke_device(project_id, device_id):
        raise HTTPException(404, "device not found or already revoked")
    db.audit(project_id, p.actor, "device.revoked", device_id)
    request.app.state.hub.publish(project_id, {"type": "device_revoked", "device_id": device_id})
    return {"ok": True}


# --- alert recipients ---------------------------------------------------------------------------------------
class Subscriber(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    channel: str
    target: str = Field(min_length=3, max_length=500)


@router.get("/projects/{project_id}/subscribers")
def list_subscribers(project_id: str, request: Request, authorization: str | None = Header(None),
                     x_guest_key: str | None = Header(None)):
    _caller(request, project_id, "admin", authorization, x_guest_key)
    subs = request.app.state.db.subscribers(project_id)
    return [{**s, "target": _mask(s["channel"], s["target"])} for s in subs]  # webhook URLs are secrets


@router.post("/projects/{project_id}/subscribers")
def add_subscriber(project_id: str, body: Subscriber, request: Request, authorization: str | None = Header(None),
                   x_guest_key: str | None = Header(None)):
    p = _caller(request, project_id, "admin", authorization, x_guest_key)
    if body.channel not in CHANNELS:
        raise HTTPException(422, f"channel must be one of {CHANNELS}")
    if body.channel in ("discord", "slack", "webhook") and not body.target.startswith("https://"):
        raise HTTPException(422, "webhook targets must be https:// URLs")
    if body.channel == "email" and not EMAIL.match(body.target):
        raise HTTPException(422, "invalid e-mail address")
    db = request.app.state.db
    db.add_subscriber(project_id, body.name.strip(), body.channel, body.target.strip())
    db.audit(project_id, p.actor, "alerts.recipient_added", f"{body.name.strip()} via {body.channel}")
    return {"ok": True}


@router.delete("/projects/{project_id}/subscribers/{subscriber_id}")
def delete_subscriber(project_id: str, subscriber_id: int, request: Request, authorization: str | None = Header(None),
                      x_guest_key: str | None = Header(None)):
    p = _caller(request, project_id, "admin", authorization, x_guest_key)
    request.app.state.db.remove_subscriber(project_id, subscriber_id)
    request.app.state.db.audit(project_id, p.actor, "alerts.recipient_removed", str(subscriber_id))
    return {"ok": True}


def _mask(channel: str, target: str) -> str:
    if channel in ("discord", "slack", "webhook"):
        return target[: target.find("/", 8) + 1] + "…" if "/" in target[8:] else "…"
    return target


# --- audit ----------------------------------------------------------------------------------------------------
@router.get("/projects/{project_id}/audit")
def audit_log(project_id: str, request: Request, authorization: str | None = Header(None),
              x_guest_key: str | None = Header(None)):
    _caller(request, project_id, "admin", authorization, x_guest_key)
    return request.app.state.db.audit_log(project_id)
