from __future__ import annotations

import hashlib
import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.core import User
from app.models.documents import Document
from app.ocr.schemas import ExtractionResult
from app.transactions import service
from app.transactions.schemas import LineItemIn, TransactionCreate


async def ingest_extraction(session: AsyncSession, document_id: uuid.UUID, payload: ExtractionResult):
    """Persist M5 extraction output as draft transactions.

    Receipts/invoices create one draft with line items, then try to reconcile into an
    existing statement transaction. Statements/CSVs create one draft per row. All rows
    dedupe on stable per-document external IDs.
    """
    document = await session.get(Document, document_id)
    if document is None:
        return None
    owner = await session.get(User, document.uploaded_by_user_id) if document.uploaded_by_user_id else None
    user = owner or User(id=document.uploaded_by_user_id, household_id=document.household_id, email="system", password_hash="x", role="owner")
    if payload.doc_type in {"receipt", "invoice"}:
        return await _ingest_receipt(session, user, document, payload)
    if payload.doc_type in {"statement", "csv"}:
        return await _ingest_statement(session, user, document, payload)
    return None


async def _ingest_receipt(session: AsyncSession, user: User, document: Document, payload: ExtractionResult):
    data = payload.data
    merchant_name = data.get("merchant")
    total = data.get("total") or data.get("subtotal")
    if not total:
        return None
    # Receipt totals are what you paid (money out → canonical negative).
    txn = await service.create_transaction(
        session,
        user,
        TransactionCreate(
            merchant=merchant_name,
            amount=-Decimal(str(total)),
            currency=data.get("currency") or "USD",
            txn_date=_date(data.get("date")),
            status="draft",
            source_document_id=document.id,
            source_channel=document.source_channel,
            confidence=payload.confidence,
            external_id=f"document:{document.id}:receipt",
            line_items=[
                LineItemIn(
                    name=i.get("name") or "Item",
                    amount=Decimal(str(i.get("amount") or 0)),
                    quantity=i.get("qty"),
                    confidence=i.get("confidence"),
                )
                for i in data.get("line_items", [])
            ],
        ),
    )
    merchant = await session.get(service.Merchant, txn.merchant_id) if txn.merchant_id else None
    return await service.reconcile_receipt(session, txn, merchant)


async def _ingest_statement(session: AsyncSession, user: User, document: Document, payload: ExtractionResult):
    rows = []
    for idx, item in enumerate(payload.data.get("transactions", [])):
        amount = item.get("amount")
        if amount is None:
            continue
        merchant = item.get("description") or payload.data.get("account_hint") or "Unknown"
        external = item.get("external_id") or _row_external_id(document.id, idx, item)
        rows.append(await service.create_transaction(
            session,
            user,
            TransactionCreate(
                merchant=merchant,
                amount=Decimal(str(amount)),
                currency=item.get("currency") or "USD",
                txn_date=_date(item.get("date")),
                status="draft",
                source_document_id=document.id,
                source_channel=document.source_channel,
                notes=item.get("description"),
                confidence=item.get("confidence", payload.confidence),
                external_id=external,
            ),
        ))
    return rows


def _date(value: str | None) -> date:
    if not value:
        return date.today()
    return date.fromisoformat(value[:10])


def _row_external_id(document_id: uuid.UUID, idx: int, item: dict) -> str:
    digest = hashlib.sha256(f"{document_id}:{idx}:{item}".encode()).hexdigest()[:20]
    return f"document:{document_id}:row:{digest}"
