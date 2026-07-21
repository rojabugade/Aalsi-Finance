"""/household endpoints: read the account's private workspace and set base currency.

Multi-user sharing (invites, join, member management, role changes) was removed:
every account is single-user and its `household` is purely the internal
tenant-isolation boundary. `household_id` is still the key threaded through every
model and every `scoped_query`.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service
from app.auth.deps import get_current_user, require_role
from app.auth.schemas import HouseholdBaseCurrencyPatch, HouseholdOut
from app.db import get_session
from app.models.core import Household, User

router = APIRouter(prefix="/household", tags=["household"])


@router.get("", response_model=HouseholdOut)
async def get_household(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Household:
    return await session.get(Household, user.household_id)


@router.patch("/base-currency", response_model=HouseholdOut)
async def update_base_currency(
    data: HouseholdBaseCurrencyPatch,
    session: AsyncSession = Depends(get_session),
    owner: User = Depends(require_role("owner")),
) -> Household:
    return await service.set_household_base_currency(session, owner, data.base_currency)
