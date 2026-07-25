"""SMTP delivery.

Uses the standard library rather than an async SMTP client: outbound mail is
low-volume and entirely off the request hot path, so a blocking send moved to a
worker thread is simpler than another dependency. Nothing here reads the database.
"""

from __future__ import annotations

import asyncio
import smtplib
import ssl
from email.message import EmailMessage

import structlog

from app.config import get_settings

log = structlog.get_logger()


class EmailNotConfigured(RuntimeError):
    """Raised when a send is attempted without SMTP settings.

    Callers decide what this means: account recovery treats it as fatal (there is
    no other way to reach the user), while the notification dispatcher records a
    delivery failure and moves on.
    """


def _build(to: str, subject: str, body_text: str, body_html: str | None) -> EmailMessage:
    settings = get_settings()
    message = EmailMessage()
    message["Subject"] = subject
    from_name = settings.email_from_name.strip()
    message["From"] = f"{from_name} <{settings.email_from}>" if from_name else settings.email_from
    message["To"] = to
    message.set_content(body_text)
    if body_html:
        message.add_alternative(body_html, subtype="html")
    return message


def _send_sync(message: EmailMessage) -> None:
    settings = get_settings()
    context = ssl.create_default_context()
    if settings.smtp_ssl:
        client = smtplib.SMTP_SSL(
            settings.smtp_host,
            settings.smtp_port,
            timeout=settings.smtp_timeout_seconds,
            context=context,
        )
    else:
        client = smtplib.SMTP(
            settings.smtp_host, settings.smtp_port, timeout=settings.smtp_timeout_seconds
        )
    with client:
        if settings.smtp_starttls and not settings.smtp_ssl:
            client.starttls(context=context)
        if settings.smtp_username:
            client.login(settings.smtp_username, settings.smtp_password)
        client.send_message(message)


async def send_email(
    to: str, subject: str, body_text: str, body_html: str | None = None
) -> None:
    """Deliver one message. Raises EmailNotConfigured or smtplib.SMTPException."""
    settings = get_settings()
    if not settings.email_configured:
        raise EmailNotConfigured("SMTP_HOST and EMAIL_FROM must be set to send email")
    message = _build(to, subject, body_text, body_html)
    await asyncio.to_thread(_send_sync, message)
    # Recipients are deliberately not logged — the subject is enough to trace a
    # delivery without putting user addresses in the log stream.
    log.info("email.sent", subject=subject)
