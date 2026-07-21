from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, require_role
from app.db import get_session
from app.fx.service import FXRateUnavailable
from app.guidance import service
from app.guidance.schemas import (
    CrossBorderTransferIn,
    CrossBorderTransferOut,
    GuidanceAskIn,
    GuidanceAskOut,
    GuidancePlanItemCreate,
    GuidancePlanItemOut,
    GuidancePlanItemUpdate,
    GuidancePlanStatus,
    GuidanceThreadOut,
    GuidanceWizardIn,
    GuidanceWizardOut,
    LimitsOut,
    ReindexOut,
)
from app.llm.client import LLMClient, get_llm_client
from app.models.core import User

router = APIRouter(tags=["guidance"])


@router.get("/guidance/plan-items", response_model=list[GuidancePlanItemOut])
async def list_plan_items(
    status: GuidancePlanStatus | None = None,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await service.list_plan_items(session, user, status=status)


@router.post(
    "/guidance/plan-items",
    response_model=GuidancePlanItemOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_plan_item(
    data: GuidancePlanItemCreate,
    user: User = Depends(require_role("owner", "member")),
    session: AsyncSession = Depends(get_session),
):
    return await service.create_plan_item(session, user, data)


@router.patch("/guidance/plan-items/{item_id}", response_model=GuidancePlanItemOut)
async def update_plan_item(
    item_id: uuid.UUID,
    data: GuidancePlanItemUpdate,
    user: User = Depends(require_role("owner", "member")),
    session: AsyncSession = Depends(get_session),
):
    try:
        return await service.update_plan_item(session, user, item_id, data)
    except service.NotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/guidance/ask", response_model=GuidanceAskOut)
async def ask_guidance(data: GuidanceAskIn, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session), llm: LLMClient = Depends(get_llm_client)):
    return await service.ask_guidance(session, user, data, llm)


@router.get("/guidance/thread/{key}/messages", response_model=GuidanceThreadOut)
async def guidance_thread_messages(
    key: Annotated[
        str,
        Path(min_length=1, max_length=96, pattern=r"^[A-Za-z0-9._~-]+$"),
    ],
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return await service.guidance_thread_history(session, user, key)


@router.post("/cross-border/ask", response_model=GuidanceAskOut)
async def cross_border_ask(data: GuidanceAskIn, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session), llm: LLMClient = Depends(get_llm_client)):
    return await service.ask_guidance(
        session,
        user,
        data.model_copy(update={"domain": "cross_border"}),
        llm,
    )


@router.post("/guidance/wizard", response_model=GuidanceWizardOut)
async def guidance_wizard(data: GuidanceWizardIn, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await service.wizard(session, user, data)


@router.post("/cross-border/wizard", response_model=GuidanceWizardOut)
async def cross_border_wizard(data: GuidanceWizardIn, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await service.wizard(session, user, data, domain="cross_border")


@router.get("/cross-border/checklist", response_model=dict)
async def cross_border_checklist(_user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await service.checklist(session, domain="cross_border")


@router.get("/cross-border/transfers", response_model=list[CrossBorderTransferOut])
async def list_transfers(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await service.list_transfers(session, user)


@router.post("/cross-border/transfers", response_model=CrossBorderTransferOut, status_code=status.HTTP_201_CREATED)
async def create_transfer(data: CrossBorderTransferIn, user: User = Depends(require_role("owner", "member")), session: AsyncSession = Depends(get_session)):
    try:
        return await service.create_transfer(session, user, data)
    except FXRateUnavailable as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc


@router.get("/cross-border/limits", response_model=LimitsOut)
async def limits(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await service.limits(session, user)


@router.post("/admin/corpus/reindex", response_model=ReindexOut, tags=["admin"])
async def reindex_corpus():
    # Household ownership is not a platform-administrator capability.  Keep the
    # global mutation unavailable until it has a separately authenticated admin
    # control plane.
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Corpus reindexing is not available")
