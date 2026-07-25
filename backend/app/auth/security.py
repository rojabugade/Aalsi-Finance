"""Primitives: password hashing, JWT access tokens, refresh-token hashing, TOTP.

Refresh tokens are opaque random strings; only their SHA-256 hash is persisted
(`refresh_token.token_hash`). Access tokens are signed JWTs. Nothing
here touches the database — callers wire these into the service layer.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
import pyotp
from passlib.context import CryptContext

from app.config import get_settings

settings = get_settings()

_pwd = CryptContext(schemes=["argon2"], deprecated="auto")

ACCESS_TOKEN_TYPE = "access"
DOWNLOAD_TOKEN_TYPE = "download"
OAUTH_STATE_TOKEN_TYPE = "oauth_state"


# --- Passwords ---------------------------------------------------------------

def hash_password(plain: str) -> str:
    return _pwd.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd.verify(plain, hashed)


# --- Refresh tokens (opaque + hashed at rest) --------------------------------

def new_refresh_token() -> tuple[str, str]:
    """Return (raw_token, sha256_hash). Send raw to client, store the hash."""
    raw = secrets.token_urlsafe(48)
    return raw, hash_refresh_token(raw)


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


# --- Emailed single-use tokens (password reset, email verification) ----------

def new_auth_token() -> tuple[str, str]:
    """Return (raw_token, sha256_hash) for an emailed link."""
    raw = secrets.token_urlsafe(48)
    return raw, hash_auth_token(raw)


def hash_auth_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


# --- MFA recovery codes ------------------------------------------------------

# Crockford-style alphabet: no I, L, O or U, so a handwritten code can't be
# misread and there are no accidental words.
_RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_RECOVERY_GROUPS = 4
_RECOVERY_GROUP_LEN = 4


def new_recovery_code() -> tuple[str, str]:
    """Return (display_code, sha256_hash).

    16 alphabet characters is ~80 bits, so a fast hash is safe here for the same
    reason it is for refresh tokens: guessing is infeasible regardless of speed.
    """
    groups = [
        "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(_RECOVERY_GROUP_LEN))
        for _ in range(_RECOVERY_GROUPS)
    ]
    code = "-".join(groups)
    return code, hash_recovery_code(code)


def hash_recovery_code(code: str) -> str:
    """Hash a recovery code, tolerating user-entered case and missing dashes."""
    normalized = code.strip().upper().replace("-", "").replace(" ", "")
    return hashlib.sha256(normalized.encode()).hexdigest()


# --- JWTs --------------------------------------------------------------------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(user_id: uuid.UUID, household_id: uuid.UUID) -> str:
    exp = _now() + timedelta(minutes=settings.access_token_ttl_minutes)
    payload = {
        "sub": str(user_id),
        "hid": str(household_id),
        "type": ACCESS_TOKEN_TYPE,
        "iat": int(_now().timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_download_token(document_id: uuid.UUID, household_id: uuid.UUID) -> str:
    """Short-lived signed token authorising a single document download (M4).

    Embeds the document + household so the public download endpoint can authorise
    without a bearer token, while still scoping to one document for one TTL window.
    """
    exp = _now() + timedelta(seconds=settings.signed_url_ttl_seconds)
    payload = {
        "sub": str(document_id),
        "hid": str(household_id),
        "type": DOWNLOAD_TOKEN_TYPE,
        "iat": _now(),
        "exp": exp,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_oauth_state(user_id: uuid.UUID, household_id: uuid.UUID) -> str:
    """Create a short-lived, signed state value for external OAuth redirects."""
    exp = _now() + timedelta(minutes=10)
    payload = {
        "sub": str(user_id),
        "hid": str(household_id),
        "type": OAUTH_STATE_TOKEN_TYPE,
        "iat": _now(),
        "exp": exp,
    }
    signed = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return f"{user_id}.{signed}"


def decode_oauth_state(state: str) -> dict[str, Any]:
    """Verify an OAuth state value and return its user/workspace claims."""
    _user_id, separator, signed = state.partition(".")
    if not separator or not signed:
        raise jwt.InvalidTokenError("invalid OAuth state")
    payload = decode_token(signed, OAUTH_STATE_TOKEN_TYPE)
    if payload.get("sub") != _user_id:
        raise jwt.InvalidTokenError("OAuth state user mismatch")
    return payload


def decode_token(token: str, expected_type: str) -> dict[str, Any]:
    """Decode + verify a JWT. Raises jwt.PyJWTError on any failure (incl. wrong type)."""
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError(f"expected {expected_type} token")
    return payload


# --- TOTP MFA ----------------------------------------------------------------

def new_totp_secret() -> str:
    return pyotp.random_base32()


def totp_provisioning_uri(secret: str, account_email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(
        name=account_email, issuer_name=settings.totp_issuer
    )


def verify_totp(secret: str, code: str) -> bool:
    # valid_window=1 tolerates a ±30s clock skew.
    return pyotp.TOTP(secret).verify(code, valid_window=1)
