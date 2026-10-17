"""Alert delivery to a project's registered people. One message per event open and per recovery."""
from __future__ import annotations

import asyncio
import logging
import smtplib
from email.message import EmailMessage

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
                f"Recommended: inspect the machine and recheck. {link}")
    else:
        subject = f"Recovered: {device['name']}"
        body = (f"Acoustic pattern back below threshold on {where} since {event['ended_at']} UTC "
                f"({event['anomalous_window_count']} anomalous windows). Recovery is not a repair confirmation. {link}")
    return subject, body


def _send_email(to: str, subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = settings.smtp_from, to, subject
    msg.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as s:
        s.starttls()
        if settings.smtp_user:
            s.login(settings.smtp_user, settings.smtp_password or "")
        s.send_message(msg)


async def deliver(subscribers: list[dict], kind: str, project: dict, device: dict, event: dict,
                  transport: httpx.AsyncBaseTransport | None = None) -> list[str]:
    """Sends to every subscriber; failures are logged, never raised into the request."""
    subject, body = format_message(kind, project, device, event)
    sent: list[str] = []
    async with httpx.AsyncClient(timeout=10, transport=transport) as http:
        for sub in subscribers:
            try:
                ch, target = sub["channel"], sub["target"]
                if ch == "telegram":
                    if not settings.telegram_bot_token:
                        raise RuntimeError("TELEGRAM_BOT_TOKEN not configured")
                    url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
                    (await http.post(url, json={"chat_id": target, "text": body, "disable_web_page_preview": True})).raise_for_status()
                elif ch == "discord":
                    (await http.post(target, json={"content": body})).raise_for_status()
                elif ch == "slack":
                    (await http.post(target, json={"text": body})).raise_for_status()
                elif ch == "webhook":
                    (await http.post(target, json={"kind": kind, "subject": subject, "text": body, "event": event})).raise_for_status()
                elif ch == "email":
                    if not settings.smtp_host:
                        raise RuntimeError("SMTP_HOST not configured")
                    await asyncio.to_thread(_send_email, target, subject, body)
                sent.append(f"{ch}:{sub['name']}")
            except Exception as err:
                log.warning("alert delivery to %s (%s) failed: %s", sub["name"], sub["channel"], err)
    return sent
