from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db import get_session
from app.models.core import User
from app.notifications import service
from app.notifications.schemas import NotificationOut, NotificationPreferences, NotificationPreferencesPatch

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationOut])
async def list_notifications(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[NotificationOut]:
    return await service.list_notifications(session, user)


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_notification_read(
    notification_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationOut:
    try:
        return await service.mark_read(session, user, notification_id)
    except service.NotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/preferences", response_model=NotificationPreferences)
async def get_notification_preferences(user: User = Depends(get_current_user)) -> NotificationPreferences:
    return service.get_preferences(user)


@router.patch("/preferences", response_model=NotificationPreferences)
async def patch_notification_preferences(
    data: NotificationPreferencesPatch,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationPreferences:
    return await service.patch_preferences(session, user, data)
