from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
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
    GuidanceWizardIn,
    GuidanceWizardOut,
    LimitsOut,
    ReindexOut,
)
from app.llm.client import LLMClient, get_llm_client
from app.models.core import User

router = APIRouter(tags=["guidance"])


@router.post("/guidance/ask", response_model=GuidanceAskOut)
async def ask_guidance(data: GuidanceAskIn, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session), llm: LLMClient = Depends(get_llm_client)):
    return await service.ask_guidance(session, user, data, llm)


@router.post("/cross-border/ask", response_model=GuidanceAskOut)
async def cross_border_ask(data: GuidanceAskIn, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session), llm: LLMClient = Depends(get_llm_client)):
    return await service.ask_guidance(session, user, data, llm)


@router.post("/guidance/wizard", response_model=GuidanceWizardOut)
async def guidance_wizard(data: GuidanceWizardIn, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await service.wizard(session, user, data)


@router.post("/cross-border/wizard", response_model=GuidanceWizardOut)
async def cross_border_wizard(data: GuidanceWizardIn, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await service.wizard(session, user, data)


@router.get("/cross-border/checklist", response_model=dict)
async def cross_border_checklist(_user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await service.checklist(session)


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
async def reindex_corpus(_user: User = Depends(require_role("owner")), session: AsyncSession = Depends(get_session), llm: LLMClient = Depends(get_llm_client)):
    return await service.reindex_corpus(session, llm)
