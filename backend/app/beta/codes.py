"""Invite-code generation, normalisation and hashing.

The wire format is ``ALSI-XXXXX-XXXXX-XXXXX``: a fixed prefix so a code is
recognisable in an email, and fifteen characters drawn from a Crockford-style
alphabet with I, L, O, U, 0 and 1 removed so nobody has to guess which glyph
they are looking at. That is 30**15, a shade over 73 bits.
"""

from __future__ import annotations

import hashlib
import re
import secrets

ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
PREFIX = "ALSI"
GROUPS = 3
GROUP_LEN = 5

_NON_CODE = re.compile(r"[^A-Z0-9]")


def generate_code() -> str:
    """A fresh code in display form. The caller is responsible for showing it —
    it cannot be recovered from the database afterwards."""
    groups = [
        "".join(secrets.choice(ALPHABET) for _ in range(GROUP_LEN))
        for _ in range(GROUPS)
    ]
    return "-".join([PREFIX, *groups])


def normalize(code: str) -> str:
    """Fold a typed code to its canonical form.

    Case, whitespace and separators are all discarded, so ``alsi abc12...``,
    ``ALSI-ABC12-...`` and ``alsiabc12...`` hash identically. Someone
    copy-pasting out of an email should not be defeated by a stray space.
    """
    return _NON_CODE.sub("", code.upper())


def hash_code(code: str) -> str:
    return hashlib.sha256(normalize(code).encode()).hexdigest()
