"""Alert delivery to a project's registered people. One message per event open and per recovery."""
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


async def deliver(subscribers: list[dict], kind: str, project: dict, device: dict, event: dict,
                  transport: httpx.AsyncBaseTransport | None = None) -> list[str]:
    """Sends to every subscriber; failures are logged, never raised into the request."""
    subject, body = format_message(kind, project, device, event)
    sent: list[str] = []
    async with httpx.AsyncClient(timeout=10, transport=transport) as http:
        for sub in subscribers:
            try:
                ch, target = sub["channel"], sub["target"]
                if ch == "discord":
                    (await http.post(target, json={"content": body})).raise_for_status()
                elif ch == "slack":
                    (await http.post(target, json={"text": body})).raise_for_status()
                elif ch == "webhook":
                    (await http.post(target, json={"kind": kind, "subject": subject, "text": body, "event": event})).raise_for_status()
                elif ch == "email":
                    if not settings.resend_api_key:
                        raise RuntimeError("RESEND_API_KEY not configured")
                    (await http.post("https://api.resend.com/emails",
                                     headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                                     json={"from": settings.email_from, "to": [target], "subject": subject,
                                           "text": body})).raise_for_status()
                sent.append(f"{ch}:{sub['name']}")
            except Exception as err:
                log.warning("alert delivery to %s (%s) failed: %s", sub["name"], sub["channel"], err)
    return sent
