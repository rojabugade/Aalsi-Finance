"""M5 OCR & extraction pipeline tests."""

from __future__ import annotations

import io
import os
import uuid

import pytest
import pytest_asyncio
from botocore.exceptions import ClientError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import Settings
from app.documents import crypto
from app.documents.storage import ObjectStore
from app.models.core import Household, User
from app.models.documents import Document
from app.models.transactions import Transaction
from app.ocr import service
from app.ocr.schemas import ResolveGroupIn, ResolveIn

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance"
)
HOUSEHOLD_PREFIX = "pytest-m5-"


KEY = "ZGV2LWluc2VjdXJlLTMyLWJ5dGUta2V5LS0tLS0tLS0="


class FakeBoto:
    def __init__(self):
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_object(self, Bucket, Key, Body, ContentType="application/octet-stream"):
        self.objects[(Bucket, Key)] = Body

    def get_object(self, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        return {"Body": io.BytesIO(self.objects[(Bucket, Key)])}

    def head_object(self, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {}


class FakeOcrEngine:
    def __init__(self, text: str, confidence: float):
        self.text = text
        self.confidence = confidence

    def image_to_text(self, image_bytes: bytes) -> tuple[str, float]:
        return self.text, self.confidence


class FakeLLM:
    def __init__(self, payload: dict):
        self.payload = payload

    async def chat(self, *args, **kwargs) -> dict:
        return self.payload

    async def vision(self, *args, **kwargs) -> dict:
        return self.payload


class FakeSession:
    def __init__(self, document: Document):
        self.document = document
        self.flushes = 0
        self.commits = 0

    async def get(self, model, ident):
        if model is Document and ident == self.document.id:
            return self.document
        return None

    async def flush(self):
        self.flushes += 1

    async def commit(self):
        self.commits += 1


def _settings(**over) -> Settings:
    base = dict(
        s3_bucket="documents",
        storage_encryption_key=KEY,
        llm_cache_enabled=False,
        llm_supports_vision=False,
        ocr_confidence_threshold=0.75,
    )
    base.update(over)
    return Settings(**base)


def _store(fake: FakeBoto, settings: Settings) -> ObjectStore:
    return ObjectStore(settings, client=fake)


def _document(doc_type: str = "receipt") -> Document:
    did = uuid.uuid4()
    storage_key = f"household/{uuid.uuid4()}/documents/{did}/original"
    return Document(
        id=did,
        household_id=uuid.uuid4(),
        uploaded_by_user_id=uuid.uuid4(),
        storage_key=storage_key,
        type=doc_type,
        source_channel="upload",
        status="uploaded",
        ocr_meta={
            "ingest": {
                "kind": "image",
                "page_keys": [storage_key],
                "original_filename": "receipt.png",
            }
        },
    )


def _receipt_payload(confidence: float = 0.95) -> dict:
    return {
        "merchant": "WALMART 2148",
        "date": "01/02/2026",
        "currency": "$",
        "subtotal": "9.00",
        "tax": "1.00",
        "total": "10.00",
        "line_items": [{"name": "Milk", "amount": "4.00", "qty": 1, "confidence": 0.9}],
        "confidence": confidence,
    }


@pytest.mark.asyncio
async def test_run_pipeline_routes_low_combined_confidence_to_review():
    settings = _settings()
    fake = FakeBoto()
    document = _document()
    fake.put_object(
        Bucket="documents",
        Key=document.storage_key,
        Body=crypto.encrypt(b"fake image", KEY),
    )

    result = await service.run_pipeline(
        session=None,
        store=_store(fake, settings),
        llm=FakeLLM(_receipt_payload(confidence=0.9)),
        document=document,
        ocr_engine=FakeOcrEngine("Walmart receipt total 10.00", 0.6),
        settings=settings,
    )

    assert result.needs_review is True
    assert result.confidence == 0.6
    assert result.data["merchant"] == "WALMART"
    assert result.data["date"] == "2026-01-02"
    assert result.summary["line_item_count"] == 1


@pytest.mark.asyncio
async def test_high_confidence_receipt_waits_for_confirmation(monkeypatch):
    """Every auto-detected upload lands at needs_review; the pipeline never auto-commits
    a transaction (handoff is reserved for resolve_review confirm)."""
    settings = _settings()
    fake = FakeBoto()
    document = _document()
    fake.put_object(
        Bucket="documents",
        Key=document.storage_key,
        Body=crypto.encrypt(b"fake image", KEY),
    )
    session = FakeSession(document)

    # The pipeline must NOT hand off to M6 ingest on its own — confirm is the only
    # path that creates transactions. Spy on the handoff to prove it isn't called.
    handoff_calls = []

    async def _spy_handoff(*args, **kwargs):
        handoff_calls.append(args)
        return False

    monkeypatch.setattr(service, "_handoff_to_m6", _spy_handoff)

    updated = await service.process_document(
        session,
        _store(fake, settings),
        FakeLLM(_receipt_payload(confidence=0.95)),
        document.id,
        ocr_engine=FakeOcrEngine("Walmart receipt total 10.00", 0.9),
        settings=settings,
    )

    assert updated is document
    assert document.status == "needs_review"
    assert handoff_calls == []  # no transaction created by the pipeline itself
    # Confidence remains a UI hint recorded in ocr_meta.
    assert document.ocr_meta["ocr"]["confidence"] == 0.9
    assert document.ocr_meta["ocr"]["data"]["total"] == "10.00"
    assert session.flushes == 1
    assert session.commits == 1
    # extracted_text must be populated so the analyst document-memory hook can index it.
    assert document.extracted_text == "Walmart receipt total 10.00"


@pytest.mark.asyncio
async def test_run_pipeline_populates_extracted_text():
    """run_pipeline must write page.text to document.extracted_text so the analyst
    document-memory hook has raw text to index (not a silent no-op)."""
    settings = _settings()
    fake = FakeBoto()
    document = _document()
    fake.put_object(
        Bucket="documents",
        Key=document.storage_key,
        Body=crypto.encrypt(b"fake image", KEY),
    )

    await service.run_pipeline(
        session=None,
        store=_store(fake, settings),
        llm=FakeLLM(_receipt_payload(confidence=0.9)),
        document=document,
        ocr_engine=FakeOcrEngine("Walmart receipt total 10.00", 0.9),
        settings=settings,
    )

    assert document.extracted_text == "Walmart receipt total 10.00"


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine(TEST_DATABASE_URL)
    try:
        async with eng.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        await eng.dispose()
        pytest.skip(f"no Postgres at {TEST_DATABASE_URL}: {exc}")
    yield eng
    async with eng.begin() as conn:
        await conn.execute(
            text("DELETE FROM household WHERE name LIKE :p"), {"p": f"{HOUSEHOLD_PREFIX}%"}
        )
    await eng.dispose()


@pytest_asyncio.fixture
async def db_session(engine):
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as s:
        yield s


async def _user(session) -> User:
    hh = Household(name=f"{HOUSEHOLD_PREFIX}{uuid.uuid4().hex[:8]}", base_currency="USD")
    session.add(hh)
    await session.flush()
    user = User(
        household_id=hh.id,
        email=f"{uuid.uuid4().hex}@example.com",
        password_hash="x",
    )
    session.add(user)
    await session.flush()
    return user


@pytest.mark.asyncio
async def test_confirm_creates_transaction_with_provenance(db_session):
    """resolve_review(confirm) is the only path that ingests: it creates a transaction
    linked back to the source document."""
    user = await _user(db_session)
    doc = Document(
        household_id=user.household_id,
        uploaded_by_user_id=user.id,
        storage_key=f"household/{user.household_id}/documents/{uuid.uuid4()}/original",
        type="receipt",
        source_channel="upload",
        status="needs_review",
        ocr_meta={
            "ocr": {
                "doc_type": "receipt",
                "needs_review": True,
                "confidence": 0.95,
                "summary": {"line_item_count": 1},
                "data": {
                    "merchant": "WALMART",
                    "date": "2026-01-02",
                    "currency": "USD",
                    "total": "10.00",
                    "line_items": [{"name": "Milk", "amount": "4.00", "qty": 1, "confidence": 0.9}],
                },
            }
        },
    )
    db_session.add(doc)
    await db_session.commit()

    resolved = await service.resolve_review(
        db_session, user, doc.id, ResolveIn(action="confirm")
    )
    assert resolved is not None
    assert resolved.status == "processed"

    txns = (
        await db_session.execute(
            select(Transaction).where(Transaction.source_document_id == doc.id)
        )
    ).scalars().all()
    assert len(txns) >= 1
    assert txns[0].source_channel == "upload"

def test_resolve_group_schema_accepts_confirm_and_split():
    confirm = ResolveGroupIn(
        member_document_ids=[str(uuid.uuid4()), str(uuid.uuid4())],
        action="confirm",
        data={"merchant": "Walmart"},
    )
    split = ResolveGroupIn(member_document_ids=[str(uuid.uuid4())], action="split")

    assert confirm.action == "confirm"
    assert confirm.data == {"merchant": "Walmart"}
    assert split.action == "split"


def test_review_group_resolve_route_registered_before_dynamic_item_route():
    from fastapi.routing import APIRoute

    from app.ocr.router import router

    routes = [(route.path, route.methods) for route in router.routes if isinstance(route, APIRoute)]
    assert ("/review-queue/group/resolve", {"POST"}) in routes
    assert routes.index(("/review-queue/group/resolve", {"POST"})) < routes.index(
        ("/review-queue/{document_id}/resolve", {"POST"})
    )


def _needs_review_receipt(user, batch_id, merchant, total, line_items):
    return Document(
        id=uuid.uuid4(),
        household_id=user.household_id,
        uploaded_by_user_id=user.id,
        storage_key="k",
        type="receipt",
        source_channel="upload",
        status="needs_review",
        ocr_meta={
            "ingest": {"batch_id": batch_id},
            "ocr": {
                "doc_type": "receipt",
                "data": {
                    "merchant": merchant,
                    "total": total,
                    "currency": "USD",
                    "date": "2026-06-27",
                    "subtotal": None,
                    "tax": None,
                    "line_items": line_items,
                },
                "confidence": 0.5,
                "needs_review": True,
                "summary": {"merchant": merchant, "total": total},
                "engine": {},
                "reasons": [],
            },
        },
    )


@pytest.mark.asyncio
async def test_resolve_group_merges_and_marks_members(db_session, monkeypatch):
    user = await _user(db_session)
    a = _needs_review_receipt(user, "b1", "Walmart", None, [{"name": "Milk", "amount": "3.00"}])
    b = _needs_review_receipt(user, "b1", None, "42.10", [{"name": "Eggs", "amount": "5.00"}])
    db_session.add(a)
    db_session.add(b)
    await db_session.commit()

    handed: list = []

    async def _spy_handoff(session, document_id, result):
        handed.append((document_id, result))
        return True

    monkeypatch.setattr("app.ocr.service._handoff_to_m6", _spy_handoff)

    primary = await service.resolve_group(db_session, user, [a.id, b.id], None)

    assert primary is not None and primary.id == a.id
    assert primary.status == "processed"
    assert primary.ocr_meta["ocr"]["data"]["merchant"] == "Walmart"
    assert primary.ocr_meta["ocr"]["data"]["total"] == "42.10"
    assert len(primary.ocr_meta["ocr"]["data"]["line_items"]) == 2

    refreshed_b = await db_session.get(Document, b.id)
    assert refreshed_b.status == "processed"
    assert refreshed_b.ocr_meta["ocr"]["merged_into"] == str(a.id)

    # Exactly one transaction handed off (the merged primary).
    assert len(handed) == 1
    assert handed[0][0] == a.id


@pytest.mark.asyncio
async def test_resolve_group_skips_stale_members(db_session, monkeypatch):
    user = await _user(db_session)
    a = _needs_review_receipt(user, "b1", "Walmart", "42.10", [])
    b = _needs_review_receipt(user, "b1", "Walmart", None, [])
    b.status = "processed"  # already resolved elsewhere
    db_session.add(a)
    db_session.add(b)
    await db_session.commit()

    monkeypatch.setattr("app.ocr.service._handoff_to_m6", lambda *a, **k: _async_true())

    primary = await service.resolve_group(db_session, user, [a.id, b.id], None)
    assert primary is not None and primary.id == a.id
    assert primary.status == "processed"


async def _async_true():
    return True


def _blank_pdf_bytes() -> bytes:
    """A one-page PDF with no embedded text — pypdf's extract_text() returns ''."""
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _pdf_document() -> Document:
    did = uuid.uuid4()
    storage_key = f"household/{uuid.uuid4()}/documents/{did}/original"
    return Document(
        id=did,
        household_id=uuid.uuid4(),
        uploaded_by_user_id=uuid.uuid4(),
        storage_key=storage_key,
        type="loan",
        source_channel="upload",
        status="uploaded",
        ocr_meta={"ingest": {"kind": "pdf", "page_keys": [storage_key],
                             "original_filename": "credila.pdf"}},
    )


def test_document_type_literal_accepts_loan():
    """Regression: DocumentOut rejected type='loan', 500-ing upload + the list feed."""
    from app.documents.schemas import DocumentType
    from typing import get_args

    assert "loan" in get_args(DocumentType)


def test_gather_text_ocrs_scanned_pdf(monkeypatch):
    """A scanned PDF (no embedded text) must be rasterised and OCR'd, not dropped."""
    from app.ocr import text as text_mod

    settings = _settings()
    fake = FakeBoto()
    document = _pdf_document()
    fake.put_object(
        Bucket="documents",
        Key=document.storage_key,
        Body=crypto.encrypt(_blank_pdf_bytes(), KEY),
    )
    # Stand in for PyMuPDF so the test doesn't require the native dep.
    monkeypatch.setattr(text_mod, "_pdf_page_to_png", lambda _b: b"fake-png-bytes")

    page = text_mod.gather_text(
        _store(fake, settings),
        document,
        settings,
        ocr_engine=FakeOcrEngine("Credila loan outstanding 500000", 0.8),
    )

    assert "Credila" in page.text
    assert page.source == "pdf-ocr"
    assert page.confidence == pytest.approx(0.8)
    assert page.image_bytes == b"fake-png-bytes"


def test_gather_text_caps_scanned_pdf_pages(monkeypatch):
    """A huge scanned PDF must not OCR unbounded pages — the cap bounds worst case."""
    from app.ocr import text as text_mod

    settings = _settings(ocr_max_scan_pages=3)
    fake = FakeBoto()
    did = uuid.uuid4()
    base = f"household/{uuid.uuid4()}/documents/{did}"
    page_keys = [f"{base}/pages/{n}.pdf" for n in range(10)]
    blank = _blank_pdf_bytes()
    for k in page_keys:
        fake.put_object(Bucket="documents", Key=k, Body=crypto.encrypt(blank, KEY))
    document = Document(
        id=did, household_id=uuid.uuid4(), uploaded_by_user_id=uuid.uuid4(),
        storage_key=page_keys[0], type="statement", source_channel="upload",
        status="uploaded",
        ocr_meta={"ingest": {"kind": "pdf", "page_keys": page_keys, "page_count": 10}},
    )

    calls = {"n": 0}

    class CountingEngine:
        def image_to_text(self, image_bytes):
            calls["n"] += 1
            return f"page {calls['n']}", 0.9

    monkeypatch.setattr(text_mod, "_pdf_page_to_png", lambda _b: b"png")
    page = text_mod.gather_text(
        _store(fake, settings), document, settings, ocr_engine=CountingEngine()
    )

    assert calls["n"] == 3  # only the first 3 scanned pages were OCR'd
    assert page.source == "pdf-ocr"


def test_gather_text_scanned_pdf_no_rasterizer_keeps_image(monkeypatch):
    """With no PDF rasteriser available, degrade cleanly (no crash, no phantom text)."""
    from app.ocr import text as text_mod

    settings = _settings()
    fake = FakeBoto()
    document = _pdf_document()
    fake.put_object(
        Bucket="documents",
        Key=document.storage_key,
        Body=crypto.encrypt(_blank_pdf_bytes(), KEY),
    )
    monkeypatch.setattr(text_mod, "_pdf_page_to_png", lambda _b: None)

    page = text_mod.gather_text(
        _store(fake, settings), document, settings,
        ocr_engine=FakeOcrEngine("unused", 0.9),
    )

    assert page.text == ""
    assert page.source == "none"
    assert page.image_bytes is None
