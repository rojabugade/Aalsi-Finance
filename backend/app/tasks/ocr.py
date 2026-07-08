"""OCR Celery task entrypoint (M5)."""

from __future__ import annotations

import uuid

import structlog

from app.celery_app import celery
from app.db import SessionLocal, run_task
from app.documents.storage import get_object_store
from app.llm.client import get_household_llm_client
from app.models.documents import Document
from app.ocr import service as ocr_service

log = structlog.get_logger()


@celery.task(name="ocr.process_document")
def process_document(document_id: str) -> dict[str, str | None]:
    """Run the async OCR pipeline from a sync Celery worker process."""
    return run_task(_process_document(document_id))


async def _process_document(document_id: str) -> dict[str, str | None]:
    try:
        parsed_id = uuid.UUID(document_id)
    except ValueError:
        log.warning("ocr.task.invalid_document_id", document_id=document_id)
        return {"document_id": document_id, "status": "invalid"}

    async with SessionLocal() as session:
        source = await session.get(Document, parsed_id)
        if source is None:
            return {"document_id": document_id, "status": "missing"}
        document = await ocr_service.process_document(
            session,
            get_object_store(),
            await get_household_llm_client(session, source.household_id),
            parsed_id,
        )
        return {
            "document_id": document_id,
            "status": document.status if document is not None else "missing",
        }
