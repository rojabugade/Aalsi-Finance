"""Document ingestion & retrieval service (M4).

The internal contract every channel (HTTP upload, and later M11 email/SMS/Plaid and
M12 bot) funnels through:

    create_document(session, store, ..., file_bytes, filename, channel) -> Document
    enqueue_ocr(document_id)

`create_document` validates the upload, encrypts the original bytes at rest, derives
per-page refs (HEIC→JPEG, multi-page PDF split), persists one `document` row, and
returns it. It never touches OCR — that's M5, reached via `enqueue_ocr`.
"""

from __future__ import annotations

import json
import uuid

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import scoped_query
from app.config import Settings, get_settings
from app.documents import crypto, processing
from app.documents.schemas import CsvMappingIn
from app.documents.storage import ObjectStore
from app.models.core import User
from app.models.documents import Document
from app.models.transactions import Merchant, Transaction

log = structlog.get_logger()

ENCRYPTION_LABEL = "AES-256-GCM"


class UploadTooLarge(Exception):
    """Raised when an upload exceeds settings.max_upload_mb."""


def _doc_prefix(household_id: uuid.UUID, document_id: uuid.UUID) -> str:
    return f"household/{household_id}/documents/{document_id}"


def _csv_mapping_key(household_id: uuid.UUID, label: str) -> str:
    return f"household/{household_id}/csv-mappings/{label}.json"


def _default_type(kind: str) -> str:
    return "csv" if kind == "csv" else "other"


async def create_document(
    session: AsyncSession,
    store: ObjectStore,
    *,
    household_id: uuid.UUID,
    uploaded_by_user_id: uuid.UUID | None,
    file_bytes: bytes,
    filename: str,
    content_type: str | None,
    channel: str = "upload",
    doc_type: str | None = None,
    source_label: str | None = None,
    batch_id: str | None = None,
    group_hint: str | None = None,
    settings: Settings | None = None,
) -> Document:
    """Validate, encrypt, store, and persist one uploaded document. Does NOT enqueue OCR."""
    settings = settings or get_settings()

    if len(file_bytes) > settings.max_upload_mb * 1024 * 1024:
        raise UploadTooLarge(
            f"upload is {len(file_bytes)} bytes, limit is {settings.max_upload_mb} MB"
        )

    # Raises UnsupportedFile for anything that isn't image / PDF / CSV.
    kind = processing.detect_kind(filename, content_type, file_bytes)

    document_id = uuid.uuid4()
    prefix = _doc_prefix(household_id, document_id)
    key = settings.storage_encryption_key

    # 1. Always store the *original* bytes, exactly as uploaded, encrypted.
    original_key = f"{prefix}/original"
    store.put(original_key, crypto.encrypt(file_bytes, key))

    # 2. Derive per-page refs (stored separately from the original).
    page_keys: list[str] = []
    stored_content_type = content_type or "application/octet-stream"
    page_count: int | None

    if kind == "image":
        if processing.is_heic(filename, content_type, file_bytes):
            # OCR can't read HEIC — derive a JPEG page.
            jpeg = processing.heic_to_jpeg(file_bytes)
            page_key = f"{prefix}/pages/0.jpg"
            store.put(page_key, crypto.encrypt(jpeg, key))
            page_keys = [page_key]
            stored_content_type = "image/jpeg"
        else:
            # The original already is the single page ref; don't duplicate bytes.
            page_keys = [original_key]
        page_count = 1
    elif kind == "pdf":
        pages = processing.split_pdf_pages(file_bytes)
        for n, page_bytes in enumerate(pages):
            page_key = f"{prefix}/pages/{n}.pdf"
            store.put(page_key, crypto.encrypt(page_bytes, key))
            page_keys.append(page_key)
        stored_content_type = "application/pdf"
        page_count = len(pages)
    else:  # csv
        stored_content_type = "text/csv"
        page_count = None

    ingest_meta = {
        "original_filename": filename,
        "content_type": stored_content_type,
        "size_bytes": len(file_bytes),
        "kind": kind,
        "page_count": page_count,
        "page_keys": page_keys,
        "encryption": ENCRYPTION_LABEL,
    }
    if source_label:
        ingest_meta["source_label"] = source_label
    if batch_id:
        ingest_meta["batch_id"] = batch_id
    if group_hint:
        ingest_meta["group_hint"] = group_hint

    document = Document(
        id=document_id,
        household_id=household_id,
        uploaded_by_user_id=uploaded_by_user_id,
        storage_key=original_key,
        type=doc_type or _default_type(kind),
        source_channel=channel,
        status="uploaded",
        ocr_meta={"ingest": ingest_meta},
    )
    session.add(document)
    await session.flush()
    log.info(
        "document.created",
        document_id=str(document_id),
        household_id=str(household_id),
        kind=kind,
        page_count=page_count,
        channel=channel,
    )
    return document


def enqueue_ocr(document_id: uuid.UUID) -> None:
    """Hand the document off to the M5 OCR pipeline. Best-effort: a broker outage
    must not fail an upload whose bytes are already safely stored."""
    try:
        from app.tasks.ocr import process_document

        process_document.delay(str(document_id))
        log.info("document.ocr_enqueued", document_id=str(document_id))
    except Exception as exc:  # noqa: BLE001
        log.warning("document.ocr_enqueue_failed", document_id=str(document_id), error=str(exc))


# --- Retrieval ---------------------------------------------------------------

async def list_documents(
    session: AsyncSession,
    user: User,
    *,
    status: str | None = None,
    doc_type: str | None = None,
) -> list[Document]:
    stmt = scoped_query(Document, user).order_by(Document.created_at.desc())
    if status:
        stmt = stmt.where(Document.status == status)
    if doc_type:
        stmt = stmt.where(Document.type == doc_type)
    return list((await session.execute(stmt)).scalars().all())


async def get_document(session: AsyncSession, user: User, document_id: uuid.UUID) -> Document | None:
    stmt = scoped_query(Document, user).where(Document.id == document_id)
    return (await session.execute(stmt)).scalar_one_or_none()


async def transactions_for_documents(
    session: AsyncSession, document_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[dict]]:
    """Map each document id to summaries of the transactions it produced."""
    if not document_ids:
        return {}
    stmt = (
        select(Transaction, Merchant.canonical_name)
        .join(Merchant, Merchant.id == Transaction.merchant_id, isouter=True)
        .where(Transaction.source_document_id.in_(document_ids))
        .order_by(Transaction.created_at)
    )
    out: dict[uuid.UUID, list[dict]] = {}
    for txn, merchant_name in (await session.execute(stmt)).all():
        out.setdefault(txn.source_document_id, []).append(
            {
                "id": txn.id,
                "merchant": merchant_name,
                "amount": txn.amount,
                "currency": txn.currency,
                "status": txn.status,
            }
        )
    return out


async def read_original_bytes(
    session: AsyncSession,
    store: ObjectStore,
    *,
    document_id: uuid.UUID,
    household_id: uuid.UUID,
    settings: Settings | None = None,
) -> tuple[bytes, str, str] | None:
    """Decrypt and return (bytes, content_type, filename) for a download token holder.

    Authorisation is by the (document_id, household_id) pair carried in the signed
    token, so this re-checks the document belongs to that household.
    """
    settings = settings or get_settings()
    document = await session.get(Document, document_id)
    if document is None or document.household_id != household_id:
        return None
    blob = store.get(document.storage_key)
    plaintext = crypto.decrypt(blob, settings.storage_encryption_key)
    ingest = (document.ocr_meta or {}).get("ingest", {})
    # The stored original keeps its uploaded content_type; derived JPEG aside, the
    # original bytes are what we hand back here.
    filename = ingest.get("original_filename") or f"{document_id}"
    content_type = ingest.get("content_type") or "application/octet-stream"
    return plaintext, content_type, filename


# --- CSV column mappings (persisted per source label, reused across uploads) --

async def save_csv_mapping(
    store: ObjectStore, household_id: uuid.UUID, mapping: CsvMappingIn, settings: Settings | None = None
) -> None:
    settings = settings or get_settings()
    payload = json.dumps(mapping.model_dump()).encode("utf-8")
    store.put(
        _csv_mapping_key(household_id, mapping.source_label),
        crypto.encrypt(payload, settings.storage_encryption_key),
    )
    log.info("csv_mapping.saved", household_id=str(household_id), label=mapping.source_label)


def load_csv_mapping(
    store: ObjectStore, household_id: uuid.UUID, label: str, settings: Settings | None = None
) -> dict | None:
    settings = settings or get_settings()
    key = _csv_mapping_key(household_id, label)
    if not store.exists(key):
        return None
    blob = store.get(key)
    return json.loads(crypto.decrypt(blob, settings.storage_encryption_key).decode("utf-8"))


def document_to_out_fields(document: Document) -> dict:
    """Flatten ocr_meta into the API surface (ingest metadata + extraction summary)."""
    meta = document.ocr_meta or {}
    ingest = meta.get("ingest", {})
    ocr = meta.get("ocr", {})
    return {
        "original_filename": ingest.get("original_filename"),
        "content_type": ingest.get("content_type"),
        "size_bytes": ingest.get("size_bytes"),
        "page_count": ingest.get("page_count"),
        "summary": ocr.get("summary"),
        "processing": ocr.get("engine"),
    }
