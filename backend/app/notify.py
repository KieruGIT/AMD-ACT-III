"""E-mail (via Resend) to a workspace's members, one per event open and per recovery; and invitation mails.

Every mail is sent as branded HTML with a plain-text twin (for clients that block HTML and for spam filters).
"""
from __future__ import annotations

import logging
from html import escape

import httpx

from .settings import settings

log = logging.getLogger("notify")

INK, MUTED, FAINT, LINE, CANVAS, TEAL, CORAL, RED = "#0f1b2d", "#545d6b", "#7a828e", "#e0ddd5", "#f3f2ee", "#1d5560", "#ef6a52", "#b42b2b"
FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"


def _app(path: str) -> str:
    return f"{settings.public_app_url.rstrip('/')}{path}"


def render_html(*, preheader: str, eyebrow: str, eyebrow_color: str, title: str, intro: str,
                rows: list[tuple[str, str]] | None = None, button: tuple[str, str] | None = None, note: str = "") -> str:
    """One branded e-mail: header, a card with a title, details table and button, then a short footer.
    Table layout with inline styles, so it renders the same in Gmail, Outlook and phone mail apps."""
    details = ""
    if rows:
        cells = "".join(
            f'<tr><td style="padding:8px 0;border-top:1px solid {LINE};color:{FAINT};font-size:13px;width:38%">{escape(k)}</td>'
            f'<td style="padding:8px 0;border-top:1px solid {LINE};color:{INK};font-size:13px;font-weight:600">{escape(v)}</td></tr>'
            for k, v in rows)
        details = f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 4px">{cells}</table>'
    cta = ""
    if button:
        label, url = button
        cta = (f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 4px"><tr>'
               f'<td style="background:{TEAL};border-radius:999px"><a href="{escape(url)}" '
               f'style="display:inline-block;padding:13px 26px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;font-family:{FONT}">'
               f'{escape(label)}</a></td></tr></table>')
    note_html = f'<p style="margin:18px 0 0;color:{FAINT};font-size:12px;line-height:1.55">{escape(note)}</p>' if note else ""
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>{escape(title)}</title></head>
<body style="margin:0;padding:0;background:{CANVAS}">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">{escape(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{CANVAS};padding:28px 12px;font-family:{FONT}">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="padding:0 6px 16px;font-size:15px;font-weight:700;color:{INK};letter-spacing:-0.01em">
      <span style="color:{TEAL}">&#8767;</span><span style="color:{CORAL}">&#9670;</span><span style="color:{TEAL}">&#8767;</span>&nbsp; Machine Sound Monitor
    </td></tr>
    <tr><td style="background:#ffffff;border:1px solid {LINE};border-radius:20px;padding:30px 28px">
      <p style="margin:0 0 8px;color:{eyebrow_color};font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase">{escape(eyebrow)}</p>
      <h1 style="margin:0;color:{INK};font-size:22px;line-height:1.25;font-weight:700;letter-spacing:-0.02em">{escape(title)}</h1>
      <p style="margin:12px 0 0;color:{MUTED};font-size:15px;line-height:1.6">{escape(intro)}</p>
      {details}{cta}{note_html}
    </td></tr>
    <tr><td style="padding:18px 6px 0;color:{FAINT};font-size:11px;line-height:1.6">
      Experimental acoustic monitoring: alerts are a prompt to inspect the machine, not a diagnosis. You get these e-mails as a
      member of a workspace; turn them off from your account menu in the console.
    </td></tr>
  </table>
</td></tr></table></body></html>"""


def format_message(kind: str, project: dict, device: dict, event: dict) -> tuple[str, str, str]:
    """(subject, text, html) for an alert opening or recovering."""
    link = _app("/app")
    where = f"{device['name']} ({event['machine_id']}) in {project['name']}"
    if kind == "opened":
        subject = f"Unusual sound: {device['name']}"
        text = (f"Persistent acoustic anomaly on {where}.\n"
                f"Since {event['started_at']} UTC. {event['reason']}.\n"
                f"Peak score {event['peak_score']:.3f} vs threshold {event['threshold']:.3f} (not a probability).\n"
                + (f"Note: {event['interference_note']}.\n" if event.get("interference_note") else "")
                + f"Recommended: inspect the machine and recheck. {link}")
        html = render_html(
            preheader=f"{device['name']} in {project['name']} has sounded different for several checks in a row.",
            eyebrow="Alert · unusual sound", eyebrow_color=RED,
            title=f"{device['name']} sounds different",
            intro=(f"The machine near {device['name']} in {project['name']} has sounded unlike its learned normal sound for "
                   "several checks in a row. Please inspect it."),
            rows=[("Workspace", project["name"]), ("Device", device["name"]), ("Since", f"{event['started_at']} UTC"),
                  ("Why", event["reason"]), ("Peak vs limit", f"{event['peak_score']:.2f} vs {event['threshold']:.2f}")]
            + ([("Note", event["interference_note"])] if event.get("interference_note") else []),
            button=("Open the console", link),
            note="The score measures how different the sound is; it is not a probability of failure.")
    else:
        subject = f"Back to normal: {device['name']}"
        text = (f"Acoustic pattern back below threshold on {where} since {event['ended_at']} UTC "
                f"({event['anomalous_window_count']} anomalous windows). Recovery is not a repair confirmation. {link}")
        html = render_html(
            preheader=f"{device['name']} in {project['name']} sounds normal again.",
            eyebrow="Recovered", eyebrow_color=TEAL,
            title=f"{device['name']} sounds normal again",
            intro=f"The sound near {device['name']} in {project['name']} is back within its learned normal range.",
            rows=[("Workspace", project["name"]), ("Device", device["name"]), ("Since", f"{event['ended_at']} UTC"),
                  ("Unusual checks", str(event["anomalous_window_count"]))],
            button=("Open the console", link),
            note="Back to normal is not a confirmation that anything was repaired.")
    return subject, text, html


async def _send_email(http: httpx.AsyncClient, to: str, subject: str, text: str, html: str | None = None) -> None:
    if not settings.resend_api_key:
        raise RuntimeError("RESEND_API_KEY not configured")
    payload = {"from": settings.email_from, "to": [to], "subject": subject, "text": text}
    if html:
        payload["html"] = html
    (await http.post("https://api.resend.com/emails", headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                     json=payload)).raise_for_status()


async def deliver(subscribers: list[dict], kind: str, project: dict, device: dict, event: dict,
                  transport: httpx.AsyncBaseTransport | None = None) -> list[str]:
    """E-mails every recipient; failures are logged, never raised into the request."""
    subject, text, html = format_message(kind, project, device, event)
    sent: list[str] = []
    async with httpx.AsyncClient(timeout=10, transport=transport) as http:
        for sub in subscribers:
            if sub["channel"] != "email":
                continue  # rows from before alerts became e-mail only
            try:
                await _send_email(http, sub["target"], subject, text, html)
                sent.append(f"email:{sub['name']}")
            except Exception as err:
                log.warning("alert e-mail to %s failed: %s", sub["name"], err)
    return sent


ROLE_WORDS = {"viewer": "view (watch and acknowledge alerts)", "admin": "edit (also add or remove devices and members)",
              "owner": "own it"}


async def send_invitation(email: str, workspace: str, role: str, invited_by: str,
                          transport: httpx.AsyncBaseTransport | None = None) -> bool:
    """Tells an invited person how to join. The invitation itself works without this mail (it is accepted on sign-in)."""
    link = _app("/signin")
    text = (f"{invited_by} invited you to the workspace \"{workspace}\" on Machine Sound Monitor as {role}.\n"
            f"Sign in or create an account with this e-mail address ({email}) to join: {link}")
    html = render_html(
        preheader=f"{invited_by} invited you to {workspace}.",
        eyebrow="Invitation", eyebrow_color=TEAL,
        title=f"Join {workspace}",
        intro=(f"{invited_by} invited you to the workspace {workspace} on Machine Sound Monitor, where you can "
               f"{ROLE_WORDS.get(role, role)}. As a member you also get an e-mail when a machine starts sounding unusual."),
        rows=[("Workspace", workspace), ("Invited by", invited_by), ("Your e-mail", email)],
        button=("Accept the invitation", link),
        note=f"Sign in, or create an account, with {email} and you join automatically.")
    try:
        async with httpx.AsyncClient(timeout=10, transport=transport) as http:
            await _send_email(http, email, f"You're invited to {workspace}", text, html)
        return True
    except Exception as err:
        log.warning("invitation e-mail to %s failed: %s", email, err)
        return False
