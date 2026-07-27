"""Transactional message bodies.

Links point at the web app (``app_origin``), which owns the reset and verification
screens and calls the API from there. Kept plain-text-first: these are security
emails, and a text body renders everywhere without tracking or remote content.
"""

from __future__ import annotations

from html import escape

from app.config import get_settings
from app.email.sender import send_email


def _link(path: str, token: str) -> str:
    origin = get_settings().app_origin.rstrip("/")
    return f"{origin}{path}?token={token}"


def _wrap_html(heading: str, paragraphs: list[str], url: str, cta: str) -> str:
    body = "".join(f"<p>{escape(p)}</p>" for p in paragraphs)
    return (
        f"<h2>{escape(heading)}</h2>{body}"
        f'<p><a href="{escape(url, quote=True)}">{escape(cta)}</a></p>'
        f"<p>{escape('If the link does not work, paste this into your browser:')}<br>"
        f"<code>{escape(url)}</code></p>"
    )


async def send_password_reset(to: str, token: str, ttl_minutes: int) -> None:
    url = _link("/reset-password", token)
    paragraphs = [
        "We received a request to reset your password.",
        f"This link is valid for {ttl_minutes} minutes and can be used once.",
        "If you did not request this, you can ignore this email — your password will not change.",
    ]
    await send_email(
        to,
        "Reset your password",
        "\n\n".join(paragraphs + [url]),
        _wrap_html("Reset your password", paragraphs, url, "Choose a new password"),
    )


async def send_email_verification(to: str, token: str, ttl_hours: int) -> None:
    url = _link("/verify-email", token)
    paragraphs = [
        "Confirm this address so we can send you alerts and account-recovery emails.",
        f"This link is valid for {ttl_hours} hours.",
    ]
    await send_email(
        to,
        "Confirm your email address",
        "\n\n".join(paragraphs + [url]),
        _wrap_html("Confirm your email address", paragraphs, url, "Confirm email"),
    )


async def send_beta_invite(to: str, code: str) -> None:
    """Hand someone their invite. Sent by the operator CLI, not by any endpoint —
    nothing a visitor can trigger mails out a code."""
    origin = get_settings().app_origin.rstrip("/")
    url = f"{origin}/login?mode=signup"
    paragraphs = [
        "You're in. Here is your invite code for the Alsi Finance beta:",
        code,
        "It works once, for one account. Enter it on the sign-up form.",
    ]
    await send_email(
        to,
        "Your Alsi Finance invite",
        "\n\n".join(paragraphs + [url]),
        _wrap_html("Your invite code", paragraphs, url, "Create your account"),
    )


async def send_password_changed(to: str) -> None:
    """Notify after a completed reset so an unexpected change is visible."""
    paragraphs = [
        "Your password was just changed and every signed-in session was ended.",
        "If this wasn't you, reset your password immediately and contact support.",
    ]
    await send_email(to, "Your password was changed", "\n\n".join(paragraphs))
