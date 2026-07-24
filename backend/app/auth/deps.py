"""`current_user` dependency + `scoped_query` — the isolation boundary for M2+.

Every authenticated endpoint depends on `get_current_user`. Every query against a
workspace-scoped table MUST be built with `scoped_query` so rows never leak across
accounts.
"""

from __future__ import annotations

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import ACCESS_TOKEN_TYPE, decode_token
from app.db import get_session
from app.models.core import User

_bearer = HTTPBearer(auto_error=True)

_CREDENTIALS_EXC = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
) -> User:
    try:
        payload = decode_token(creds.credentials, ACCESS_TOKEN_TYPE)
        user_id = payload["sub"]
    except (jwt.PyJWTError, KeyError):
        raise _CREDENTIALS_EXC

    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise _CREDENTIALS_EXC
    return user


def scoped_query(model, user: User) -> Select:
    """Build a SELECT pre-filtered to the caller's private workspace."""
    stmt = select(model)
    if hasattr(model, "household_id"):
        stmt = stmt.where(model.household_id == user.household_id)

    return stmt
