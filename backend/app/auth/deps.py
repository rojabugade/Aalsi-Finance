"""`current_user` dependency + `scoped_query` — the isolation boundary for M2+.

Every authenticated endpoint depends on `get_current_user`. Every query against a
household-scoped table MUST be built with `scoped_query` so rows never leak across
households, and personal (non-shared) rows never leak across members.
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


def require_role(*allowed: str):
    """Dependency factory: 403 unless the current user holds one of `allowed` roles."""

    async def _checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient role",
            )
        return user

    return _checker


def scoped_query(model, user: User) -> Select:
    """Build a SELECT pre-filtered to the user's household and visibility.

    - Always constrains `household_id` to the caller's household (if the model has it).
    - For `member`/`viewer`, also hides other members' personal rows: a row is visible
      when it is shared (`is_shared` true) or owned by the caller (`owner_user_id`).
      `owner` sees everything in the household.
    """
    stmt = select(model)
    if hasattr(model, "household_id"):
        stmt = stmt.where(model.household_id == user.household_id)

    if user.role != "owner" and hasattr(model, "owner_user_id"):
        if hasattr(model, "is_shared"):
            stmt = stmt.where(
                (model.is_shared.is_(True)) | (model.owner_user_id == user.id)
            )
        else:
            stmt = stmt.where(model.owner_user_id == user.id)
    return stmt
