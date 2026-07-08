"""At-rest encryption for stored document bytes (M4).

Documents are encrypted with AES-256-GCM before they reach object storage, so the
storage backend (MinIO / S3 / disk) never holds plaintext. The 96-bit nonce is
random per object and prepended to the ciphertext; GCM's tag (appended by the
library) authenticates the payload. The key comes from `settings.storage_encryption_key`
(base64, 32 bytes) — rotating it makes previously stored documents undecryptable.
"""

from __future__ import annotations

import base64
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

NONCE_BYTES = 12


class DecryptionError(Exception):
    """Raised when stored bytes fail GCM authentication (wrong key or corruption)."""


def _load_key(b64_key: str) -> bytes:
    try:
        key = base64.b64decode(b64_key)
    except Exception as exc:  # noqa: BLE001
        raise ValueError("storage_encryption_key is not valid base64") from exc
    if len(key) != 32:
        raise ValueError(
            f"storage_encryption_key must decode to 32 bytes, got {len(key)}"
        )
    return key


def encrypt(plaintext: bytes, b64_key: str) -> bytes:
    """Return nonce || ciphertext || tag, ready to write to storage."""
    key = _load_key(b64_key)
    nonce = os.urandom(NONCE_BYTES)
    ct = AESGCM(key).encrypt(nonce, plaintext, None)
    return nonce + ct


def decrypt(blob: bytes, b64_key: str) -> bytes:
    """Reverse `encrypt`. Raises `DecryptionError` on a bad key / tampered bytes."""
    key = _load_key(b64_key)
    if len(blob) < NONCE_BYTES + 16:  # nonce + minimum GCM tag
        raise DecryptionError("ciphertext too short")
    nonce, ct = blob[:NONCE_BYTES], blob[NONCE_BYTES:]
    try:
        return AESGCM(key).decrypt(nonce, ct, None)
    except InvalidTag as exc:
        raise DecryptionError("authentication failed (wrong key or corruption)") from exc
