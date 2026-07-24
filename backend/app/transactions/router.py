from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db import get_session
from app.models.core import User
from app.models.transactions import Transaction
from app.transactions import service
from app.transactions.schemas import (
    CategoryIn,
    CategoryMergeIn,
    CategoryOut,
    LineItemIn,
    LinkReceiptIn,
    MergeIn,
    RuleIn,
    RuleOut,
    SplitIn,
    TagIn,
    TagOut,
    TransactionCreate,
    LineItemOut,
    TransactionOut,
    TransactionPatch,
)

router = APIRouter(tags=["transactions"])


async def _transaction_out(session: AsyncSession, txn: Transaction) -> TransactionOut:
    items = (await service.line_items_for(session, [txn.id])).get(txn.id, [])
    merchant = None
    if txn.merchant_id:
        merchant = (await service.merchant_names_for(session, [txn.merchant_id])).get(txn.merchant_id)
    return TransactionOut.model_validate(txn).model_copy(
        update={"line_items": [LineItemOut.model_validate(i) for i in items], "merchant": merchant}
    )


def _not_found(exc: service.NotFound):
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/transactions", response_model=list[TransactionOut])
async def list_transactions(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[TransactionOut]:
    txns = await service.list_transactions(session, user)
    items = await service.line_items_for(session, [t.id for t in txns])
    merchants = await service.merchant_names_for(session, [t.merchant_id for t in txns if t.merchant_id])
    return [
        TransactionOut.model_validate(t).model_copy(
            update={
                "line_items": [LineItemOut.model_validate(i) for i in items.get(t.id, [])],
                "merchant": merchants.get(t.merchant_id),
            }
        )
        for t in txns
    ]


@router.post("/transactions", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    data: TransactionCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TransactionOut:
    try:
        txn = await service.create_transaction(session, user, data)
    except service.NotFound as exc:
        _not_found(exc)
    return await _transaction_out(session, txn)


@router.post("/transactions/merge", response_model=TransactionOut)
async def merge_transactions(
    data: MergeIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TransactionOut:
    try:
        txn = await service.merge_transactions(session, user, data.transaction_ids, data.notes)
    except service.NotFound as exc:
        _not_found(exc)
    return await _transaction_out(session, txn)


@router.get("/transactions/{transaction_id}", response_model=TransactionOut)
async def get_transaction(
    transaction_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TransactionOut:
    try:
        txn = await service.get_transaction(session, user, transaction_id)
    except service.NotFound as exc:
        _not_found(exc)
    return await _transaction_out(session, txn)


@router.patch("/transactions/{transaction_id}", response_model=TransactionOut)
async def patch_transaction(
    transaction_id: uuid.UUID,
    data: TransactionPatch,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TransactionOut:
    try:
        txn = await service.patch_transaction(session, user, transaction_id, data)
    except service.NotFound as exc:
        _not_found(exc)
    return await _transaction_out(session, txn)


@router.delete("/transactions/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(
    transaction_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    try:
        await service.delete_transaction(session, user, transaction_id)
    except service.NotFound as exc:
        _not_found(exc)


@router.post("/transactions/{transaction_id}/confirm", response_model=TransactionOut)
async def confirm_transaction(
    transaction_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TransactionOut:
    try:
        txn = await service.confirm_transaction(session, user, transaction_id)
    except service.NotFound as exc:
        _not_found(exc)
    return await _transaction_out(session, txn)


@router.post("/transactions/{transaction_id}/split", response_model=list[TransactionOut])
async def split_transaction(
    transaction_id: uuid.UUID,
    data: SplitIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[TransactionOut]:
    try:
        rows = await service.split_transaction(session, user, transaction_id, data)
    except service.NotFound as exc:
        _not_found(exc)
    return [await _transaction_out(session, row) for row in rows]


@router.post("/transactions/{transaction_id}/line-items", response_model=TransactionOut)
async def add_line_items(
    transaction_id: uuid.UUID,
    items: list[LineItemIn],
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TransactionOut:
    try:
        txn = await service.get_transaction(session, user, transaction_id)
        await service.add_line_items(session, txn, items)
        await session.commit()
        await session.refresh(txn)
    except service.NotFound as exc:
        _not_found(exc)
    return await _transaction_out(session, txn)


@router.post("/transactions/{transaction_id}/link-receipt", response_model=TransactionOut)
async def link_receipt(
    transaction_id: uuid.UUID,
    data: LinkReceiptIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TransactionOut:
    try:
        txn = await service.link_receipt(
            session, user, transaction_id, data.receipt_transaction_id, data.receipt_document_id
        )
    except service.NotFound as exc:
        _not_found(exc)
    return await _transaction_out(session, txn)


@router.get("/categories", response_model=list[CategoryOut], tags=["taxonomy"])
async def list_categories(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[CategoryOut]:
    return list(await service.list_categories(session, user))


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED, tags=["taxonomy"])
async def create_category(
    data: CategoryIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CategoryOut:
    return await service.create_category(session, user, data)


@router.post("/categories/{category_id}/merge", status_code=status.HTTP_204_NO_CONTENT, tags=["taxonomy"])
async def merge_category(
    category_id: uuid.UUID,
    data: CategoryMergeIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    try:
        await service.merge_category(session, user, category_id, data.into_category_id)
    except service.NotFound as exc:
        _not_found(exc)


@router.get("/tags", response_model=list[TagOut], tags=["taxonomy"])
async def list_tags(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[TagOut]:
    return list(await service.list_tags(session, user))


@router.post("/tags", response_model=TagOut, status_code=status.HTTP_201_CREATED, tags=["taxonomy"])
async def create_tag(
    data: TagIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TagOut:
    return await service.create_tag(session, user, data)


@router.get("/rules", response_model=list[RuleOut], tags=["taxonomy"])
async def list_rules(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[RuleOut]:
    return list(await service.list_rules(session, user))


@router.post("/rules", response_model=RuleOut, status_code=status.HTTP_201_CREATED, tags=["taxonomy"])
async def create_rule(
    data: RuleIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RuleOut:
    return await service.create_rule(session, user, data)
