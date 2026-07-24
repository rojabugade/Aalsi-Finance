"""Private-workspace endpoints.

``household_id`` remains an internal tenant-isolation key; this public API exposes
only the signed-in account's private workspace and base currency.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service
from app.auth.deps import get_current_user
from app.auth.schemas import WorkspaceBaseCurrencyPatch, WorkspaceOut
from app.db import get_session
from app.models.core import Household, User

router = APIRouter(prefix="/workspace", tags=["workspace"])


@router.get("", response_model=WorkspaceOut)
async def get_workspace(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Household:
    return await session.get(Household, user.household_id)


@router.patch("/base-currency", response_model=WorkspaceOut)
async def update_base_currency(
    data: WorkspaceBaseCurrencyPatch,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Household:
    return await service.set_workspace_base_currency(session, user, data.base_currency)
