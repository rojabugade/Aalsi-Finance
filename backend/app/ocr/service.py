"""Pipeline orchestration + review queue (M5).

`process_document` is the work the Celery task performs: load → gather text → extract →
normalise → score → route. High-confidence results are written to `ocr_meta["ocr"]`,
the document marked `processed`, and the typed payload handed to M6's
`ingest_extraction` (best-effort seam until M6 lands). Low-confidence results land in
the review queue (`needs_review`) for a human to confirm/correct via the router.

Transaction *persistence* is explicitly M6's job — here we only emit the normalised,
confidence-scored payload.
"""

from __future__ import annotations

import csv
import io
import uuid
from decimal import Decimal

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import scoped_query
from app.config import Settings, get_settings
from app.documents import crypto
from app.documents.service import load_csv_mapping
from app.documents.storage import ObjectStore
from app.llm.client import LLMClient
from app.llm.errors import LLMError
from app.models.core import User
from app.models.documents import Document
from app.ocr import local_parse, normalize
from app.ocr.engine import OcrEngine
from app.ocr.grouping import merge_extractions
from app.ocr.extract import extract_structured
from app.ocr.schemas import SCHEMA_FOR_TYPE, ExtractionResult, ResolveIn
from app.ocr.text import gather_text

log = structlog.get_logger()


# --- normalisation per doc type ---------------------------------------------


def _norm_receipt(data: dict, settings: Settings) -> tuple[dict, dict]:
    currency = normalize.normalize_currency(data.get("currency"))
    items = []
    for it in data.get("line_items", []) or []:
        items.append(
            {
                "name": it.get("name"),
                "amount": _s(normalize.to_amount(it.get("amount"))),
                "qty": it.get("qty"),
                "confidence": it.get("confidence", 1.0),
            }
        )
    clean = {
        "merchant": normalize.canonical_merchant(data.get("merchant")),
        "date": normalize.to_iso_date(data.get("date")),
        "currency": currency,
        "subtotal": _s(normalize.to_amount(data.get("subtotal"))),
        "tax": _s(normalize.to_amount(data.get("tax"))),
        "total": _s(normalize.to_amount(data.get("total"))),
        "line_items": items,
    }
    summary = {
        "merchant": clean["merchant"],
        "total": clean["total"],
        "currency": currency,
        "date": clean["date"],
        "line_item_count": len(items),
    }
    return clean, summary


def _norm_statement(data: dict, settings: Settings) -> tuple[dict, dict]:
    txns = []
    for t in data.get("transactions", []) or []:
        txns.append(
            {
                "date": normalize.to_iso_date(t.get("date")),
                "description": t.get("description"),
                "amount": _s(normalize.to_amount(t.get("amount"))),
                "balance": _s(normalize.to_amount(t.get("balance"))),
                "confidence": t.get("confidence", 1.0),
            }
        )
    clean = {"account_hint": data.get("account_hint"), "transactions": txns}
    summary = {"account_hint": data.get("account_hint"), "transaction_count": len(txns)}
    return clean, summary


def _norm_paystub(data: dict, settings: Settings) -> tuple[dict, dict]:
    deductions = [
        {"name": d.get("name"), "amount": _s(normalize.to_amount(d.get("amount")))}
        for d in data.get("deductions", []) or []
    ]
    clean = {
        "employer": data.get("employer"),
        "period_start": normalize.to_iso_date(data.get("period_start")),
        "period_end": normalize.to_iso_date(data.get("period_end")),
        "gross": _s(normalize.to_amount(data.get("gross"))),
        "net": _s(normalize.to_amount(data.get("net"))),
        "deductions": deductions,
    }
    summary = {
        "employer": clean["employer"],
        "gross": clean["gross"],
        "net": clean["net"],
        "period_end": clean["period_end"],
    }
    return clean, summary


def _norm_loan(data: dict, settings: Settings) -> tuple[dict, dict]:
    clean = {
        "name": data.get("name"),
        "type": data.get("type", "other"),
        "principal": _s(normalize.to_amount(data.get("principal"))),
        "interest_rate": data.get("interest_rate"),
        "min_or_emi_amount": _s(normalize.to_amount(data.get("min_or_emi_amount"))),
        "start_date": normalize.to_iso_date(data.get("start_date")),
        "due_day": data.get("due_day"),
    }
    summary = {
        "name": clean["name"],
        "type": clean["type"],
        "principal": clean["principal"],
        "interest_rate": clean["interest_rate"],
    }
    return clean, summary


_NORMALIZERS = {
    "receipt": _norm_receipt,
    "invoice": _norm_receipt,
    "statement": _norm_statement,
    "paystub": _norm_paystub,
    "loan": _norm_loan,
}


def _s(value: Decimal | None) -> str | None:
    return str(value) if value is not None else None


# --- CSV deterministic path --------------------------------------------------


def _csv_extract(store: ObjectStore, document: Document, settings: Settings) -> ExtractionResult:
    ingest = (document.ocr_meta or {}).get("ingest", {})
    label = ingest.get("source_label")
    engine = {"ocr": "csv", "vision": False}

    mapping = load_csv_mapping(store, document.household_id, label, settings=settings) if label else None
    if mapping is None:
        reason = (
            f"no saved CSV mapping for source label {label!r}"
            if label
            else "CSV uploaded without a source_label; cannot map columns"
        )
        return ExtractionResult(
            doc_type="csv", data={}, confidence=0.0, needs_review=True,
            summary={}, engine=engine, reasons=[reason],
        )

    raw = crypto.decrypt(store.get(document.storage_key), settings.storage_encryption_key)
    text = raw.decode("utf-8", errors="ignore")
    reader = csv.DictReader(io.StringIO(text))
    default_ccy = mapping.get("default_currency")
    txns, missing_cols = [], False
    for row in reader:
        if mapping.get("debit_column") or mapping.get("credit_column"):
            amount = normalize.combine_debit_credit(
                row.get(mapping.get("debit_column", "")), row.get(mapping.get("credit_column", ""))
            )
        else:
            if mapping["amount"] not in row:
                missing_cols = True
            amount = normalize.to_amount(row.get(mapping["amount"]))
        currency = None
        if mapping.get("currency"):
            currency = normalize.normalize_currency(row.get(mapping["currency"]), default_ccy)
        txns.append(
            {
                "date": normalize.to_iso_date(row.get(mapping["date"])),
                "description": row.get(mapping["description"]),
                "amount": _s(amount),
                "currency": currency or (default_ccy.upper() if default_ccy else None),
                "confidence": 1.0,
            }
        )

    reasons = ["CSV mapping references columns absent from the file"] if missing_cols else []
    return ExtractionResult(
        doc_type="csv",
        data={"account_hint": label, "transactions": txns},
        confidence=0.0 if missing_cols else 1.0,
        needs_review=missing_cols,
        summary={"account_hint": label, "transaction_count": len(txns)},
        engine=engine,
        reasons=reasons,
    )


# --- main pipeline -----------------------------------------------------------


async def run_pipeline(
    session: AsyncSession,
    store: ObjectStore,
    llm: LLMClient,
    document: Document,
    *,
    ocr_engine: OcrEngine | None = None,
    settings: Settings | None = None,
) -> ExtractionResult:
    settings = settings or get_settings()
    doc_type = document.type

    if doc_type == "csv":
        return _csv_extract(store, document, settings)

    # Read the document (local OCR for images, embedded text for PDFs) BEFORE we
    # commit to a type — "auto-detect" uploads arrive as "other" and we classify
    # them from their content here.
    page = gather_text(store, document, settings, ocr_engine)

    if doc_type not in SCHEMA_FOR_TYPE:
        guessed = local_parse.classify(page.text)
        if guessed is None:
            # Couldn't tell what it is. Keep the OCR text so the user can still see
            # and categorise it, rather than handing back an empty card.
            document.extracted_text = page.text or None
            reason = (
                "could not classify document type from its contents"
                if page.text.strip()
                else "no text could be read from the document"
            )
            return ExtractionResult(
                doc_type="other", data={}, confidence=0.0, needs_review=True,
                summary={"text_preview": (page.text or "")[:280] or None},
                engine={"ocr": page.source, "vision": False, "extractor": "none"},
                reasons=[reason],
            )
        doc_type = guessed
        document.type = guessed  # persist the detected type

    if not page.text.strip() and not page.image_bytes:
        return ExtractionResult(
            doc_type=doc_type, data={}, confidence=0.0, needs_review=True, summary={},
            engine={"ocr": page.source, "vision": False, "extractor": "none"},
            reasons=["no text or image could be extracted from the document"],
        )

    # Persist raw OCR/PDF text so the analyst document-memory hook can index it.
    # Image-only docs where page.text is empty will store NULL (acceptable W1 limit).
    document.extracted_text = page.text or None

    # Default path is local: structure the OCR text with the LLM when one is
    # configured, but fall back to the deterministic on-box parser when it isn't
    # reachable — so extraction never depends on (or silently requires) an LLM.
    try:
        raw, vision_used = await extract_structured(
            llm, doc_type, page, settings=settings, session=session, document_id=document.id
        )
        extractor = "vision-llm" if vision_used else "text-llm"
    except LLMError as exc:
        log.info("ocr.llm_unavailable_local_fallback", document_id=str(document.id), error=str(exc))
        raw = local_parse.parse(doc_type, page.text)
        vision_used = False
        extractor = "local-heuristic"

    clean, summary = _NORMALIZERS[doc_type](raw, settings)

    llm_conf = float(raw.get("confidence", 0.0) or 0.0)
    if vision_used:
        combined = llm_conf
    else:
        ocr_conf = page.confidence if page.source != "none" else 1.0
        combined = min(ocr_conf, llm_conf)

    needs_review = combined < settings.ocr_confidence_threshold
    reasons = []
    if needs_review:
        reasons.append(
            f"confidence {combined:.2f} below threshold {settings.ocr_confidence_threshold}"
        )
    return ExtractionResult(
        doc_type=doc_type,
        data=clean,
        confidence=round(combined, 4),
        needs_review=needs_review,
        summary=summary,
        engine={"ocr": page.source, "vision": vision_used, "extractor": extractor},
        reasons=reasons,
    )


def _write_ocr_meta(document: Document, result: ExtractionResult) -> None:
    # Reassign the whole dict so SQLAlchemy flags the JSONB column dirty.
    meta = dict(document.ocr_meta or {})
    meta["ocr"] = {
        "doc_type": result.doc_type,
        "data": result.data,
        "confidence": result.confidence,
        "needs_review": result.needs_review,
        "summary": result.summary,
        "engine": result.engine,
        "reasons": result.reasons,
    }
    document.ocr_meta = meta


async def process_document(
    session: AsyncSession,
    store: ObjectStore,
    llm: LLMClient,
    document_id: uuid.UUID,
    *,
    ocr_engine: OcrEngine | None = None,
    settings: Settings | None = None,
) -> Document | None:
    """Full pipeline for one document. Loads, runs, writes ocr_meta, routes, commits."""
    settings = settings or get_settings()
    document = await session.get(Document, document_id)
    if document is None:
        log.warning("ocr.document_missing", document_id=str(document_id))
        return None

    document.status = "processing"
    await session.flush()

    try:
        result = await run_pipeline(
            session, store, llm, document, ocr_engine=ocr_engine, settings=settings
        )
    except Exception as exc:  # noqa: BLE001
        meta = dict(document.ocr_meta or {})
        meta["ocr"] = {"error": str(exc)}
        document.ocr_meta = meta
        document.status = "failed"
        await session.commit()
        log.exception("ocr.pipeline_failed", document_id=str(document_id), error=str(exc))
        return document

    _write_ocr_meta(document, result)
    # Every auto-detected upload waits for explicit user confirmation before any
    # transaction is created. Confidence is a UI hint (in ocr_meta), not an
    # auto-commit switch. resolve_review(confirm) is the only path that ingests.
    document.status = "needs_review"
    await session.commit()
    log.info(
        "ocr.processed",
        document_id=str(document_id),
        status=document.status,
        confidence=result.confidence,
        doc_type=result.doc_type,
    )
    return document


async def _handoff_to_m6(session: AsyncSession, document_id: uuid.UUID, result: ExtractionResult) -> bool:
    """Emit the extraction to M6's ingest. Best-effort: M6 may not be built yet."""
    try:
        from app.transactions.ingest import ingest_extraction  # type: ignore
    except ImportError:
        log.info("ocr.m6_not_available", document_id=str(document_id))
        return False
    await ingest_extraction(session, document_id, result)  # type: ignore
    return True


# --- review queue ------------------------------------------------------------


async def list_review_queue(session: AsyncSession, user: User) -> list[Document]:
    stmt = (
        scoped_query(Document, user)
        .where(Document.status == "needs_review")
        .order_by(Document.created_at.desc())
    )
    return list((await session.execute(stmt)).scalars().all())


async def resolve_review(
    session: AsyncSession, user: User, document_id: uuid.UUID, resolve: ResolveIn
) -> Document | None:
    stmt = scoped_query(Document, user).where(Document.id == document_id)
    document = (await session.execute(stmt)).scalar_one_or_none()
    if document is None:
        return None

    meta = dict(document.ocr_meta or {})
    ocr = dict(meta.get("ocr", {}))

    if resolve.action == "reject":
        document.status = "failed"
        await session.commit()
        log.info("ocr.review_rejected", document_id=str(document_id))
        return document

    # confirm (optionally with corrected data)
    if resolve.data is not None:
        ocr["data"] = resolve.data
    ocr["needs_review"] = False
    meta["ocr"] = ocr
    document.ocr_meta = meta
    document.status = "processed"
    await session.flush()

    result = ExtractionResult(
        doc_type=ocr.get("doc_type", document.type),
        data=ocr.get("data", {}),
        confidence=float(ocr.get("confidence", 1.0) or 1.0),
        needs_review=False,
        summary=ocr.get("summary", {}),
        engine=ocr.get("engine", {}),
        reasons=[],
    )
    await _handoff_to_m6(session, document.id, result)
    await session.commit()
    log.info("ocr.review_confirmed", document_id=str(document_id))

    # Best-effort memory indexing — a failure here must never break document processing.
    try:
        from app.analyst.memory.facts import index_document_memory
        from app.llm.client import get_household_llm_client

        llm = await get_household_llm_client(session, user.household_id)
        await index_document_memory(session, user, document, llm)
    except Exception:  # memory indexing must never fail document processing
        pass

    return document


async def resolve_group(
    session: AsyncSession,
    user: User,
    member_document_ids: list[uuid.UUID],
    data: dict | None,
) -> Document | None:
    """Confirm a suggested same-receipt group: merge survivors into one transaction.

    Re-reads members and ignores any no longer needs_review (stale). The first
    survivor is the primary (carries the merged extraction + the ingested txn);
    the rest are marked processed with ocr_meta["ocr"]["merged_into"].
    """
    stmt = scoped_query(Document, user).where(Document.id.in_(member_document_ids))
    found = {d.id: d for d in (await session.execute(stmt)).scalars().all()}
    # Preserve the caller's order; keep only still-pending members.
    survivors = [
        found[mid] for mid in member_document_ids
        if mid in found and found[mid].status == "needs_review"
    ]
    if not survivors:
        return None

    primary = survivors[0]
    merged_data, merged_summary = merge_extractions(survivors)
    if data is not None:
        merged_data = data

    primary_ocr = dict((primary.ocr_meta or {}).get("ocr", {}))
    primary_meta = dict(primary.ocr_meta or {})
    primary_ocr["data"] = merged_data
    primary_ocr["summary"] = merged_summary
    primary_ocr["needs_review"] = False
    primary_meta["ocr"] = primary_ocr
    primary.ocr_meta = primary_meta
    primary.status = "processed"

    for member in survivors[1:]:
        meta = dict(member.ocr_meta or {})
        ocr = dict(meta.get("ocr", {}))
        ocr["needs_review"] = False
        ocr["merged_into"] = str(primary.id)
        meta["ocr"] = ocr
        member.ocr_meta = meta
        member.status = "processed"

    await session.flush()

    result = ExtractionResult(
        doc_type=primary_ocr.get("doc_type", primary.type),
        data=merged_data,
        confidence=float(primary_ocr.get("confidence", 1.0) or 1.0),
        needs_review=False,
        summary=merged_summary,
        engine=primary_ocr.get("engine", {}),
        reasons=[],
    )
    await _handoff_to_m6(session, primary.id, result)
    await session.commit()
    log.info("ocr.group_confirmed", primary_id=str(primary.id),
             members=len(survivors))

    # Best-effort memory indexing — never break processing.
    try:
        from app.analyst.memory.facts import index_document_memory
        from app.llm.client import get_household_llm_client

        llm = await get_household_llm_client(session, user.household_id)
        await index_document_memory(session, user, primary, llm)
    except Exception:
        pass

    return primary
