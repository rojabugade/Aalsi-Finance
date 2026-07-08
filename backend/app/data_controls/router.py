from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.data_controls import service
from app.data_controls.schemas import AccountDeleteIn, ConsentOut, SettingsOut, SettingsPatch
from app.db import get_session
from app.models.core import User

router = APIRouter(tags=["data-controls"])


@router.get("/export")
async def export_data(
    format: str = Query(..., pattern="^(csv|pdf)$"),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if format == "csv":
        payload = await service.export_csv_zip(session, user)
        return StreamingResponse(
            iter([payload]),
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=finance-export.zip"},
        )
    payload = await service.export_pdf(session, user)
    return StreamingResponse(
        iter([payload]),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=finance-summary.pdf"},
    )


@router.get("/settings", response_model=SettingsOut)
async def get_settings(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await service.get_settings(session, user)


@router.patch("/settings", response_model=SettingsOut)
async def patch_settings(data: SettingsPatch, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await service.patch_settings(session, user, data)


@router.get("/consents", response_model=list[ConsentOut])
async def get_consents(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await service.list_consents(session, user)


@router.post("/consents/{channel}/revoke", response_model=ConsentOut)
async def revoke_consent(channel: str, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    return await service.revoke_consent(session, user, channel)


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(data: AccountDeleteIn, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    await service.delete_account(session, user, data.confirmation)
