"""Diagnostics router for the LLM gateway (M3).

The only HTTP surface M3 exposes: an authenticated-account ping that does one real round-trip
to the configured provider and logs usage, so operators can confirm wiring without
shelling into the box. All real LLM use is the internal Python API.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db import get_session
from app.llm.client import LLMClient, get_llm_client
from app.llm.errors import LLMError
from app.models.core import User

router = APIRouter(prefix="/admin/llm", tags=["admin"])


@router.post("/ping")
async def ping(
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    client: LLMClient = Depends(get_llm_client),
) -> dict:
    try:
        result = await client.ping(session=session)
    except LLMError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"LLM provider error: {exc}",
        )
    await session.commit()
    return result
