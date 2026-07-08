"""Review queue endpoints for OCR/extraction results (M5)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db import get_session
from app.models.core import User
from app.models.documents import Document
from app.ocr import service
from app.ocr.grouping import ReviewGroup, group_review_documents
from app.ocr.schemas import (
    ResolveGroupIn,
    ResolveIn,
    ReviewGroupOut,
    ReviewItemOut,
    ReviewQueueOut,
)

router = APIRouter(tags=["review-queue"])


def _to_review_out(document: Document) -> ReviewItemOut:
    meta = document.ocr_meta or {}
    ocr = meta.get("ocr", {})
    return ReviewItemOut(
        document_id=str(document.id),
        type=document.type,
        status=document.status,
        confidence=ocr.get("confidence"),
        summary=ocr.get("summary"),
        data=ocr.get("data"),
        reasons=ocr.get("reasons", []),
        batch_id=(meta.get("ingest", {}) or {}).get("batch_id"),
    )


def _group_to_out(group: ReviewGroup, by_id: dict[str, Document]) -> ReviewGroupOut:
    suggested = ReviewItemOut(
        document_id=group.member_ids[0],
        type=group.doc_type,
        status="needs_review",
        confidence=group.confidence,
        summary=group.summary,
        data=group.data,
        reasons=[],
        batch_id=_to_review_out(by_id[group.member_ids[0]]).batch_id,
    )
    return ReviewGroupOut(
        member_document_ids=group.member_ids,
        suggested=suggested,
        members=[_to_review_out(by_id[mid]) for mid in group.member_ids],
    )


def build_review_queue(documents: list[Document]) -> ReviewQueueOut:
    by_id = {str(d.id): d for d in documents}
    groups, loose = group_review_documents(documents)
    return ReviewQueueOut(
        groups=[_group_to_out(g, by_id) for g in groups],
        items=[_to_review_out(d) for d in loose],
    )


@router.get("/review-queue", response_model=ReviewQueueOut)
async def list_review_queue(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ReviewQueueOut:
    documents = await service.list_review_queue(session, user)
    return build_review_queue(documents)


@router.post("/review-queue/group/resolve", response_model=ReviewQueueOut)
async def resolve_review_group(
    resolve: ResolveGroupIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ReviewQueueOut:
    if resolve.action == "split":
        # Server no-op: the client falls back to per-card confirm.
        return await list_review_queue(user=user, session=session)

    ids = [uuid.UUID(mid) for mid in resolve.member_document_ids]
    primary = await service.resolve_group(session, user, ids, resolve.data)
    if primary is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No pending members to merge",
        )
    return await list_review_queue(user=user, session=session)


@router.post("/review-queue/{document_id}/resolve", response_model=ReviewItemOut)
async def resolve_review_item(
    document_id: uuid.UUID,
    resolve: ResolveIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ReviewItemOut:
    document = await service.resolve_review(session, user, document_id, resolve)
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Review item not found",
        )
    return _to_review_out(document)
