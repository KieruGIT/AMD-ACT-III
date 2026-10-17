"""Who is calling, and what may they do in a workspace.

- Signed-in people: `Authorization: Bearer <Supabase access token>`. The token is verified against the Supabase
  project's published signing keys (JWKS), falling back to asking Supabase Auth itself (projects on the legacy shared
  secret). Access to a workspace comes from membership (owner / admin / viewer).
- Guests: `X-Guest-Key` for a temporary guest workspace (owner rights inside it; deleted after 2 h).
- Listening devices: `X-Device-Key` (issued once by pairing). Devices can upload and read their own session only.
- Legacy viewer keys (`X-Viewer-Key`, admin CLI links): viewer rights. Kept for local tooling.
"""
from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass
from typing import Callable

import httpx
from fastapi import HTTPException, Request

from .db import hash_key
from .settings import settings

RANK = {"viewer": 1, "admin": 2, "owner": 3}


@dataclass(frozen=True)
class User:
    id: str
    email: str


@dataclass(frozen=True)
class Principal:
    kind: str  # user | guest | viewer_key | device
    project_id: str
    role: str  # owner | admin | viewer | device
    actor: str  # shown in the audit log
    user_id: str | None = None
    device_id: str | None = None

    def at_least(self, role: str) -> bool:
        return RANK.get(self.role, 0) >= RANK[role]


class SupabaseVerifier:
    """Verifies Supabase access tokens. Results are cached briefly so each request does not hit the network."""

    def __init__(self, url: str, publishable_key: str | None):
        self.url, self.key = url.rstrip("/"), publishable_key
        self._jwks = None
        self._cache: dict[str, tuple[float, User]] = {}

    def __call__(self, token: str) -> User:
        h = hashlib.sha256(token.encode()).hexdigest()
        hit = self._cache.get(h)
        if hit and hit[0] > time.time():
            return hit[1]
        user, exp = self._verify(token)
        self._cache = {k: v for k, v in self._cache.items() if v[0] > time.time()}
        self._cache[h] = (min(exp, time.time() + 300), user)
        return user

    def _verify(self, token: str) -> tuple[User, float]:
        import jwt

        try:
            if self._jwks is None:
                self._jwks = jwt.PyJWKClient(f"{self.url}/auth/v1/.well-known/jwks.json", cache_keys=True)
            key = self._jwks.get_signing_key_from_jwt(token)
            claims = jwt.decode(token, key.key, algorithms=["ES256", "RS256"], audience="authenticated")
            return User(claims["sub"], (claims.get("email") or "").lower()), float(claims["exp"])
        except jwt.ExpiredSignatureError:
            raise HTTPException(401, "session expired: sign in again")
        except (jwt.PyJWKClientError, jwt.InvalidAlgorithmError, jwt.DecodeError, KeyError):
            pass  # legacy HS256 project (no public keys): ask Supabase Auth instead
        except jwt.InvalidTokenError:
            raise HTTPException(401, "invalid session token")
        r = httpx.get(f"{self.url}/auth/v1/user", timeout=10,
                      headers={"Authorization": f"Bearer {token}", **({"apikey": self.key} if self.key else {})})
        if r.status_code != 200:
            raise HTTPException(401, "invalid session token")
        u = r.json()
        return User(u["id"], (u.get("email") or "").lower()), time.time() + 60


def build_verifier() -> Callable[[str], User] | None:
    if not settings.supabase_url:
        return None
    return SupabaseVerifier(settings.supabase_url, settings.supabase_publishable_key)


def current_user(request: Request, authorization: str | None) -> User | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    verify = request.app.state.verify_token
    if verify is None:
        raise HTTPException(401, "sign-in is not configured on this server")
    return verify(authorization.split(" ", 1)[1].strip())


def require_user(request: Request, authorization: str | None) -> User:
    user = current_user(request, authorization)
    if not user:
        raise HTTPException(401, "sign in required")
    if not user.email:
        raise HTTPException(403, "account has no e-mail address")
    return user


def principal(request: Request, project_id: str | None, *, authorization: str | None = None,
              guest_key: str | None = None, viewer_key: str | None = None, device_key: str | None = None,
              min_role: str = "viewer", allow_device: bool = False) -> Principal:
    """Resolve the caller for one workspace and enforce the minimum role (403 otherwise)."""
    db = request.app.state.db
    if not project_id:
        raise HTTPException(401, "workspace id required")
    project = db.project(project_id)
    if not project:
        raise HTTPException(403, "unknown or expired workspace")
    p: Principal | None = None
    user = current_user(request, authorization)
    if user:
        m = db.member(project_id, user.id)
        if not m:
            raise HTTPException(403, "you are not a member of this workspace")
        p = Principal("user", project_id, m["role"], user.email, user_id=user.id)
    elif guest_key and project.get("is_guest") and project["viewer_key_hash"] == hash_key(guest_key):
        p = Principal("guest", project_id, "owner", "guest")
    elif viewer_key and not project.get("is_guest") and project["viewer_key_hash"] == hash_key(viewer_key):
        p = Principal("viewer_key", project_id, "viewer", "viewer link")
    elif device_key and allow_device:
        d = db.device_by_key(project_id, device_key)
        if d:
            p = Principal("device", project_id, "device", f"device {d['name']}", device_id=d["id"])
    if p is None:
        raise HTTPException(401 if not (authorization or guest_key or viewer_key or device_key) else 403,
                            "sign in or use a valid key for this workspace")
    if p.kind != "device" and not p.at_least(min_role):
        raise HTTPException(403, f"needs the {min_role} role")
    return p
