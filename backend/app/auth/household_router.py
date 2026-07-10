"""/household endpoints: read household, invite/join, list & manage members."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service
from app.auth.cookies import set_auth_cookies
from app.auth.deps import get_current_user, require_role
from app.auth.schemas import (
    AccessToken,
    HouseholdBaseCurrencyPatch,
    HouseholdCreateIn,
    HouseholdOut,
    InviteIn,
    InviteOut,
    JoinIn,
    MemberOut,
    RoleUpdateIn,
)
from app.db import get_session
from app.models.core import Household, User

router = APIRouter(prefix="/household", tags=["household"])


@router.get("", response_model=HouseholdOut)
async def get_household(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Household:
    return await session.get(Household, user.household_id)


@router.post("", response_model=HouseholdOut)
async def create_household(
    data: HouseholdCreateIn,
    session: AsyncSession = Depends(get_session),
    owner: User = Depends(require_role("owner")),
) -> Household:
    return await service.enable_household_sharing(session, owner, data.name)


@router.patch("/base-currency", response_model=HouseholdOut)
async def update_base_currency(
    data: HouseholdBaseCurrencyPatch,
    session: AsyncSession = Depends(get_session),
    owner: User = Depends(require_role("owner")),
) -> Household:
    return await service.set_household_base_currency(session, owner, data.base_currency)


@router.post("/invite", response_model=InviteOut)
async def invite_member(
    data: InviteIn,
    session: AsyncSession = Depends(get_session),
    owner: User = Depends(require_role("owner")),
) -> InviteOut:
    token = await service.create_invite(session, owner, data.email, data.role)
    return InviteOut(invite_token=token, email=data.email, role=data.role)


@router.post("/join", response_model=AccessToken, status_code=status.HTTP_201_CREATED)
async def join_household(
    data: JoinIn, response: Response, session: AsyncSession = Depends(get_session)
) -> AccessToken:
    access, refresh = await service.join(session, data)
    set_auth_cookies(response, refresh)
    return AccessToken(access_token=access)


@router.get("/members", response_model=list[MemberOut])
async def list_members(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[User]:
    return await service.list_members(session, user.household_id)


@router.patch("/members/{member_id}", response_model=MemberOut)
async def change_member_role(
    member_id: uuid.UUID,
    data: RoleUpdateIn,
    session: AsyncSession = Depends(get_session),
    owner: User = Depends(require_role("owner")),
) -> User:
    return await service.change_role(session, owner, member_id, data.role)


@router.delete("/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    member_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    owner: User = Depends(require_role("owner")),
):
    await service.remove_member(session, owner, member_id)
