from __future__ import annotations

import base64

from app.config import get_settings
from app.documents.crypto import decrypt, encrypt


def encrypt_string(value: str) -> str:
    return base64.b64encode(encrypt(value.encode("utf-8"), get_settings().storage_encryption_key)).decode("ascii")


def decrypt_string(value: str | None) -> str | None:
    if not value:
        return None
    return decrypt(base64.b64decode(value.encode("ascii")), get_settings().storage_encryption_key).decode("utf-8")
