"""Outbound email: SMTP delivery plus the transactional messages built on it."""

from app.email.sender import EmailNotConfigured, send_email

__all__ = ["EmailNotConfigured", "send_email"]
