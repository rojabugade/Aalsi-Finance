from __future__ import annotations

import uuid

import jwt
import pytest

from app.auth.security import create_oauth_state, decode_oauth_state


def test_oauth_state_round_trip() -> None:
    user_id = uuid.uuid4()
    household_id = uuid.uuid4()

    claims = decode_oauth_state(create_oauth_state(user_id, household_id))

    assert claims["sub"] == str(user_id)
    assert claims["hid"] == str(household_id)


def test_oauth_state_rejects_tampering() -> None:
    user_id = uuid.uuid4()
    state = create_oauth_state(user_id, uuid.uuid4())
    _prefix, signed = state.split(".", 1)

    with pytest.raises(jwt.PyJWTError):
        decode_oauth_state(f"{uuid.uuid4()}.{signed}")
