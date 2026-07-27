"""Document ingestion & retrieval endpoints (M4).

POST /documents accepts a multipart upload, stores it encrypted, and enqueues OCR
(M5) without blocking. Reads are household-scoped. File retrieval hands back a
short-lived signed URL pointing at a token-gated download route that streams the
decrypted original — the only place plaintext leaves the box.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import jwt
import structlog
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.beta.limits import enforce_document_quota
from app.auth.security import (
    DOWNLOAD_TOKEN_TYPE,
    create_download_token,
    decode_token,
)
from app.config import get_settings
from app.db import get_session
from app.documents import service
from app.documents.processing import UnsupportedFile
from app.documents.schemas import (
    CsvMappingIn,
    CsvMappingOut,
    DocumentOut,
    SignedUrlOut,
)
from app.documents.service import UploadTooLarge
from app.documents.storage import ObjectStore, get_object_store
from pydantic import BaseModel

from app.models.core import User
from app.models.documents import Document

log = structlog.get_logger()
router = APIRouter(prefix="/documents", tags=["documents"])


class _PrivacyIn(BaseModel):
    private: bool


def _to_out(document: Document, txn_refs: list[dict] | None = None) -> DocumentOut:
    return DocumentOut(
        id=document.id,
        type=document.type,
        source_channel=document.source_channel,
        status=document.status,
        created_at=document.created_at,
        transactions=txn_refs or [],
        **service.document_to_out_fields(document),
    )


@router.post("", status_code=status.HTTP_201_CREATED, response_model=DocumentOut, dependencies=[Depends(enforce_document_quota)])
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    type: str | None = Form(default=None),
    source_channel: str = Form(default="upload"),
    source_label: str | None = Form(default=None),
    batch_id: str | None = Form(default=None),
    group_hint: str | None = Form(default=None),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    store: ObjectStore = Depends(get_object_store),
) -> DocumentOut:
    file_bytes = await file.read()
    try:
        document = await service.create_document(
            session,
            store,
            household_id=user.household_id,
            uploaded_by_user_id=user.id,
            file_bytes=file_bytes,
            filename=file.filename or "upload",
            content_type=file.content_type,
            channel=source_channel,
            doc_type=type,
            source_label=source_label,
            batch_id=batch_id,
            group_hint=group_hint,
        )
    except UploadTooLarge as exc:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=str(exc))
    except UnsupportedFile as exc:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=str(exc))

    await session.commit()
    await session.refresh(document)
    # Enqueue OCR only after the row is durably committed (best-effort).
    service.enqueue_ocr(document.id)
    return _to_out(document)


@router.get("", response_model=list[DocumentOut])
async def list_documents(
    status_filter: str | None = None,
    type: str | None = None,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[DocumentOut]:
    docs = await service.list_documents(session, user, status=status_filter, doc_type=type)
    refs = await service.transactions_for_documents(session, [d.id for d in docs])
    return [_to_out(d, refs.get(d.id)) for d in docs]


@router.get("/{document_id}", response_model=DocumentOut)
async def get_document(
    document_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DocumentOut:
    document = await service.get_document(session, user, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    refs = await service.transactions_for_documents(session, [document.id])
    return _to_out(document, refs.get(document.id))


@router.get("/{document_id}/file", response_model=SignedUrlOut)
async def get_document_file(
    document_id: uuid.UUID,
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SignedUrlOut:
    document = await service.get_document(session, user, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    token = create_download_token(document.id, user.household_id)
    url = str(request.url_for("download_document", document_id=document.id)) + f"?token={token}"
    expires_at = datetime.now(timezone.utc) + timedelta(
        seconds=get_settings().signed_url_ttl_seconds
    )
    return SignedUrlOut(url=url, expires_at=expires_at)


@router.patch("/{document_id}/privacy", response_model=DocumentOut)
async def set_document_privacy(
    document_id: uuid.UUID,
    body: _PrivacyIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DocumentOut:
    document = await service.get_document(session, user, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if body.private:
        # Local import to avoid potential circular import at module load time.
        # Purge BEFORE flipping the flag so the toggle and the memory deletion
        # commit atomically: a purge failure rolls back the flag too, leaving the
        # document non-private and un-purged rather than private with memory intact.
        from app.analyst.memory.facts import purge_document_memory
        await purge_document_memory(session, user.household_id, document.id)
    document.private = body.private
    await session.commit()
    await session.refresh(document)
    return _to_out(document)


@router.get("/{document_id}/file/download", name="download_document")
async def download_document(
    document_id: uuid.UUID,
    token: str,
    session: AsyncSession = Depends(get_session),
    store: ObjectStore = Depends(get_object_store),
) -> Response:
    """Token-gated streaming of the decrypted original. No bearer auth — the
    short-lived signed token is the credential, scoped to one document."""
    try:
        payload = decode_token(token, DOWNLOAD_TOKEN_TYPE)
        if payload["sub"] != str(document_id):
            raise ValueError("token/document mismatch")
        household_id = uuid.UUID(payload["hid"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired download token"
        )

    result = await service.read_original_bytes(
        session, store, document_id=document_id, household_id=household_id
    )
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    data, content_type, filename = result
    return Response(
        content=data,
        media_type=content_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


# --- CSV column mappings -----------------------------------------------------

@router.put("/csv-mappings", response_model=CsvMappingOut)
async def put_csv_mapping(
    mapping: CsvMappingIn,
    user: User = Depends(get_current_user),
    store: ObjectStore = Depends(get_object_store),
) -> CsvMappingOut:
    await service.save_csv_mapping(store, user.household_id, mapping)
    return CsvMappingOut(**mapping.model_dump())


@router.get("/csv-mappings/{label}", response_model=CsvMappingOut)
async def get_csv_mapping(
    label: str,
    user: User = Depends(get_current_user),
    store: ObjectStore = Depends(get_object_store),
) -> CsvMappingOut:
    data = service.load_csv_mapping(store, user.household_id, label)
    if data is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mapping not found")
    return CsvMappingOut(**data)
