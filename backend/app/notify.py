"""E-mail (via Resend) to a workspace's alert recipients, one per event open and per recovery; and invitation mails."""
from __future__ import annotations

import logging

import httpx

from .settings import settings

log = logging.getLogger("notify")


def format_message(kind: str, project: dict, device: dict, event: dict) -> tuple[str, str]:
    link = f"{settings.public_app_url}/app?project={project['id']}"
    where = f"{device['name']} ({event['machine_id']}) in {project['name']}"
    if kind == "opened":
        subject = f"Persistent acoustic anomaly: {device['name']}"
        body = (f"Persistent acoustic anomaly on {where}.\n"
                f"Since {event['started_at']} UTC. {event['reason']}.\n"
                f"Peak score {event['peak_score']:.3f} vs threshold {event['threshold']:.3f} (not a probability).\n"
                + (f"Note: {event['interference_note']}.\n" if event.get("interference_note") else "")
                + f"Recommended: inspect the machine and recheck. {link}")
    else:
        subject = f"Recovered: {device['name']}"
        body = (f"Acoustic pattern back below threshold on {where} since {event['ended_at']} UTC "
                f"({event['anomalous_window_count']} anomalous windows). Recovery is not a repair confirmation. {link}")
    return subject, body


async def _send_email(http: httpx.AsyncClient, to: str, subject: str, text: str) -> None:
    if not settings.resend_api_key:
        raise RuntimeError("RESEND_API_KEY not configured")
    (await http.post("https://api.resend.com/emails", headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                     json={"from": settings.email_from, "to": [to], "subject": subject, "text": text})).raise_for_status()


async def deliver(subscribers: list[dict], kind: str, project: dict, device: dict, event: dict,
                  transport: httpx.AsyncBaseTransport | None = None) -> list[str]:
    """E-mails every recipient; failures are logged, never raised into the request."""
    subject, body = format_message(kind, project, device, event)
    sent: list[str] = []
    async with httpx.AsyncClient(timeout=10, transport=transport) as http:
        for sub in subscribers:
            if sub["channel"] != "email":
                continue  # rows from before alerts became e-mail only
            try:
                await _send_email(http, sub["target"], subject, body)
                sent.append(f"email:{sub['name']}")
            except Exception as err:
                log.warning("alert e-mail to %s failed: %s", sub["name"], err)
    return sent


async def send_invitation(email: str, workspace: str, role: str, invited_by: str,
                          transport: httpx.AsyncBaseTransport | None = None) -> bool:
    """Tells an invited person how to join. The invitation itself works without this mail (it is accepted on sign-in)."""
    link = f"{settings.public_app_url.rstrip('/')}/signin"
    text = (f"{invited_by} invited you to the workspace \"{workspace}\" on Machine Sound Monitor as {role}.\n"
            f"Sign in or create an account with this e-mail address ({email}) to join: {link}")
    try:
        async with httpx.AsyncClient(timeout=10, transport=transport) as http:
            await _send_email(http, email, f"You're invited to {workspace}", text)
        return True
    except Exception as err:
        log.warning("invitation e-mail to %s failed: %s", email, err)
        return False
