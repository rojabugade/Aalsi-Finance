"""M4 document ingestion & storage tests.

Unit tests exercise the encrypt-store-derive pipeline against an in-memory fake S3
client (no live MinIO): image, HEIC→JPEG, multi-page PDF split, CSV, size/type
guards, and CSV-mapping round-trips. One Postgres-guarded HTTP test covers the
done-condition end-to-end — upload a multi-page PDF and a HEIC, confirm both store
encrypted with an OCR job enqueued, list them, and retrieve the original via the
short-lived signed URL.
"""

from __future__ import annotations

import io
import os
import uuid

import pytest
import pytest_asyncio
from botocore.exceptions import ClientError
from httpx import ASGITransport, AsyncClient
from pypdf import PdfWriter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import Settings
from app.documents import crypto, processing, service
from app.documents.schemas import CsvMappingIn
from app.documents.storage import ObjectStore

try:
    import pillow_heif
    from PIL import Image

    pillow_heif.register_heif_opener()
    IMAGE_LIBS_AVAILABLE = True
    IMAGE_LIBS_ERROR = None
except Exception as exc:  # noqa: BLE001
    Image = None
    IMAGE_LIBS_AVAILABLE = False
    IMAGE_LIBS_ERROR = exc

# --------------------------------------------------------------------------- #
# Fakes & sample files
# --------------------------------------------------------------------------- #


class FakeBoto:
    """Minimal in-memory stand-in for a boto3 S3 client."""

    def __init__(self):
        self.objects: dict[tuple[str, str], bytes] = {}

    def head_bucket(self, Bucket):
        return {}

    def create_bucket(self, Bucket):
        return {}

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

    def delete_object(self, Bucket, Key):
        self.objects.pop((Bucket, Key), None)


class FakeSession:
    """Captures .add-ed ORM objects; flush is a no-op (for create_document unit tests)."""

    def __init__(self):
        self.added: list = []

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        return None


def _settings(**over) -> Settings:
    base = dict(
        s3_bucket="documents",
        max_upload_mb=1,
        storage_encryption_key="ZGV2LWluc2VjdXJlLTMyLWJ5dGUta2V5LS0tLS0tLS0=",
        signed_url_ttl_seconds=300,
    )
    base.update(over)
    return Settings(**base)


def _store(fake) -> ObjectStore:
    return ObjectStore(_settings(), client=fake)


def png_bytes() -> bytes:
    if Image is None:
        pytest.skip(f"Pillow/Pillow-Heif unavailable: {IMAGE_LIBS_ERROR}")
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (255, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


def heic_bytes() -> bytes:
    if Image is None:
        pytest.skip(f"Pillow/Pillow-Heif unavailable: {IMAGE_LIBS_ERROR}")
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (0, 128, 0)).save(buf, format="HEIF")
    return buf.getvalue()


def pdf_bytes(pages: int) -> bytes:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def csv_bytes() -> bytes:
    return b"date,description,amount\n2026-01-01,Coffee,3.50\n"


# --------------------------------------------------------------------------- #
# Crypto + processing units
# --------------------------------------------------------------------------- #

KEY = "ZGV2LWluc2VjdXJlLTMyLWJ5dGUta2V5LS0tLS0tLS0="


def test_crypto_roundtrip():
    pt = b"sensitive financial bytes"
    blob = crypto.encrypt(pt, KEY)
    assert blob != pt
    assert crypto.decrypt(blob, KEY) == pt


def test_crypto_wrong_key_fails():
    blob = crypto.encrypt(b"x", KEY)
    other = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="  # 32 zero bytes
    with pytest.raises(crypto.DecryptionError):
        crypto.decrypt(blob, other)


def test_detect_kind_by_magic_bytes():
    assert processing.detect_kind("x.bin", "application/octet-stream", pdf_bytes(1)) == "pdf"
    assert processing.detect_kind("x.bin", None, png_bytes()) == "image"
    assert processing.detect_kind("x.csv", "text/csv", csv_bytes()) == "csv"


def test_detect_kind_rejects_unsupported():
    with pytest.raises(processing.UnsupportedFile):
        processing.detect_kind("x.exe", "application/x-msdownload", b"MZ\x90\x00")


def test_split_pdf_pages_counts():
    pages = processing.split_pdf_pages(pdf_bytes(3))
    assert len(pages) == 3
    assert all(p[:4] == b"%PDF" for p in pages)


def test_heic_converts_to_jpeg():
    if not IMAGE_LIBS_AVAILABLE:
        pytest.skip(f"Pillow/Pillow-Heif unavailable: {IMAGE_LIBS_ERROR}")
    jpeg = processing.heic_to_jpeg(heic_bytes())
    assert jpeg[:3] == b"\xff\xd8\xff"  # JPEG SOI


# --------------------------------------------------------------------------- #
# create_document units
# --------------------------------------------------------------------------- #

HID = uuid.uuid4()
UID = uuid.uuid4()


@pytest.mark.asyncio
async def test_create_document_image_stores_encrypted_single_page():
    fake = FakeBoto()
    session = FakeSession()
    doc = await service.create_document(
        session, _store(fake),
        household_id=HID, uploaded_by_user_id=UID,
        file_bytes=png_bytes(), filename="receipt.png", content_type="image/png",
        settings=_settings(),
    )
    assert doc.status == "uploaded"
    assert doc.type == "other"
    ingest = doc.ocr_meta["ingest"]
    assert ingest["page_count"] == 1
    assert ingest["encryption"] == "AES-256-GCM"
    # Non-HEIC image: the single page ref IS the original (no duplicate object).
    assert ingest["page_keys"] == [doc.storage_key]
    # Stored bytes are ciphertext, and decrypt back to the upload.
    stored = fake.objects[("documents", doc.storage_key)]
    assert stored != png_bytes()
    assert crypto.decrypt(stored, KEY) == png_bytes()


@pytest.mark.asyncio
async def test_create_document_heic_derives_jpeg_page():
    if not IMAGE_LIBS_AVAILABLE:
        pytest.skip(f"Pillow/Pillow-Heif unavailable: {IMAGE_LIBS_ERROR}")
    fake = FakeBoto()
    doc = await service.create_document(
        FakeSession(), _store(fake),
        household_id=HID, uploaded_by_user_id=UID,
        file_bytes=heic_bytes(), filename="photo.heic", content_type="image/heic",
        settings=_settings(),
    )
    ingest = doc.ocr_meta["ingest"]
    assert ingest["content_type"] == "image/jpeg"
    assert ingest["page_keys"] != [doc.storage_key]  # derived JPEG, separate object
    page_blob = fake.objects[("documents", ingest["page_keys"][0])]
    assert crypto.decrypt(page_blob, KEY)[:3] == b"\xff\xd8\xff"
    # Original HEIC bytes are still kept under storage_key.
    assert crypto.decrypt(fake.objects[("documents", doc.storage_key)], KEY) == heic_bytes()


@pytest.mark.asyncio
async def test_create_document_pdf_splits_pages():
    fake = FakeBoto()
    doc = await service.create_document(
        FakeSession(), _store(fake),
        household_id=HID, uploaded_by_user_id=UID,
        file_bytes=pdf_bytes(3), filename="statement.pdf", content_type="application/pdf",
        doc_type="statement", settings=_settings(),
    )
    ingest = doc.ocr_meta["ingest"]
    assert doc.type == "statement"
    assert ingest["page_count"] == 3
    assert len(ingest["page_keys"]) == 3
    # 1 original + 3 page objects all stored.
    assert len(fake.objects) == 4


@pytest.mark.asyncio
async def test_create_document_csv_defaults_type():
    fake = FakeBoto()
    doc = await service.create_document(
        FakeSession(), _store(fake),
        household_id=HID, uploaded_by_user_id=UID,
        file_bytes=csv_bytes(), filename="export.csv", content_type="text/csv",
        source_label="chase", settings=_settings(),
    )
    assert doc.type == "csv"
    assert doc.ocr_meta["ingest"]["page_count"] is None
    assert doc.ocr_meta["ingest"]["source_label"] == "chase"


@pytest.mark.asyncio
async def test_create_document_rejects_oversize():
    fake = FakeBoto()
    big = os.urandom(2 * 1024 * 1024)  # 2 MB > 1 MB test limit
    with pytest.raises(service.UploadTooLarge):
        await service.create_document(
            FakeSession(), _store(fake),
            household_id=HID, uploaded_by_user_id=UID,
            file_bytes=big, filename="big.png", content_type="image/png",
            settings=_settings(),
        )


@pytest.mark.asyncio
async def test_create_document_rejects_unsupported():
    fake = FakeBoto()
    with pytest.raises(processing.UnsupportedFile):
        await service.create_document(
            FakeSession(), _store(fake),
            household_id=HID, uploaded_by_user_id=UID,
            file_bytes=b"MZ\x90\x00executable", filename="x.exe",
            content_type="application/x-msdownload", settings=_settings(),
        )


@pytest.mark.asyncio
async def test_csv_mapping_roundtrip():
    fake = FakeBoto()
    store = _store(fake)
    mapping = CsvMappingIn(
        source_label="chase", date="Date", description="Description",
        amount="Amount", default_currency="USD",
    )
    await service.save_csv_mapping(store, HID, mapping, settings=_settings())
    loaded = service.load_csv_mapping(store, HID, "chase", settings=_settings())
    assert loaded["amount"] == "Amount"
    assert loaded["default_currency"] == "USD"
    # Mapping is encrypted at rest, not stored as plain JSON.
    key = f"household/{HID}/csv-mappings/chase.json"
    assert b"Amount" not in fake.objects[("documents", key)]
    assert service.load_csv_mapping(store, HID, "missing", settings=_settings()) is None


# --------------------------------------------------------------------------- #
# Done-condition HTTP test (needs Postgres)
# --------------------------------------------------------------------------- #

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://finance:finance@localhost:5433/finance",
)
HOUSEHOLD_PREFIX = "pytest-m4-"


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
            text(
                "DELETE FROM document WHERE household_id IN "
                "(SELECT id FROM household WHERE name LIKE :p)"
            ),
            {"p": f"{HOUSEHOLD_PREFIX}%"},
        )
        await conn.execute(
            text("DELETE FROM household WHERE name LIKE :p"), {"p": f"{HOUSEHOLD_PREFIX}%"}
        )
    await eng.dispose()


@pytest.mark.asyncio
async def test_upload_lifecycle_end_to_end(engine, monkeypatch):
    if not IMAGE_LIBS_AVAILABLE:
        pytest.skip(f"Pillow/Pillow-Heif unavailable: {IMAGE_LIBS_ERROR}")
    from app.db import get_session
    from app.documents.storage import get_object_store
    from app.main import app

    session_factory = async_sessionmaker(bind=engine, expire_on_commit=False)
    shared_store = ObjectStore(_settings(), client=FakeBoto())

    async def _override_session():
        async with session_factory() as s:
            yield s

    enqueued: list[str] = []
    monkeypatch.setattr(service, "enqueue_ocr", lambda did: enqueued.append(str(did)))

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_object_store] = lambda: shared_store
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            email = f"{uuid.uuid4().hex[:12]}@example.com"
            su = await c.post(
                "/auth/signup",
                json={
                    "email": email, "password": "hunter2pass", "display_name": "Owner",
                    "workspace_name": f"{HOUSEHOLD_PREFIX}docs",
                },
            )
            assert su.status_code == 201, su.text
            token = su.json()["access_token"]
            auth = {"Authorization": f"Bearer {token}"}

            # Unauthenticated upload is rejected.
            anon = await c.post("/documents", files={"file": ("x.pdf", pdf_bytes(1), "application/pdf")})
            assert anon.status_code in (401, 403)

            # Upload a multi-page PDF and a HEIC photo.
            up_pdf = await c.post(
                "/documents", headers=auth,
                files={"file": ("statement.pdf", pdf_bytes(2), "application/pdf")},
                data={"type": "statement"},
            )
            assert up_pdf.status_code == 201, up_pdf.text
            pdf_doc = up_pdf.json()
            assert pdf_doc["status"] == "uploaded"
            assert pdf_doc["page_count"] == 2

            up_heic = await c.post(
                "/documents", headers=auth,
                files={"file": ("photo.heic", heic_bytes(), "image/heic")},
            )
            assert up_heic.status_code == 201, up_heic.text
            heic_doc = up_heic.json()
            assert heic_doc["content_type"] == "image/jpeg"

            # Both enqueued OCR.
            assert len(enqueued) == 2

            # List shows both, newest first.
            lst = await c.get("/documents", headers=auth)
            assert lst.status_code == 200
            assert len(lst.json()) == 2

            # Filter by status.
            filtered = await c.get("/documents?status_filter=uploaded", headers=auth)
            assert len(filtered.json()) == 2

            # Signed URL → download returns the decrypted original PDF bytes.
            su_url = await c.get(f"/documents/{pdf_doc['id']}/file", headers=auth)
            assert su_url.status_code == 200
            url = su_url.json()["url"]
            dl = await c.get(url)  # no bearer — the token authorises
            assert dl.status_code == 200
            assert dl.content[:4] == b"%PDF"

            # A tampered/empty token is rejected.
            bad = await c.get(f"/documents/{pdf_doc['id']}/file/download?token=garbage")
            assert bad.status_code == 401

            # CSV mapping save + reuse.
            put = await c.put(
                "/documents/csv-mappings", headers=auth,
                json={"source_label": "chase", "date": "Date",
                      "description": "Desc", "amount": "Amount", "default_currency": "USD"},
            )
            assert put.status_code == 200
            got = await c.get("/documents/csv-mappings/chase", headers=auth)
            assert got.status_code == 200
            assert got.json()["amount"] == "Amount"
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_documents_list_includes_provenance(engine, monkeypatch):
    """GET /documents reports the transactions each document produced (provenance)."""
    from app.db import get_session
    from app.documents.storage import get_object_store
    from app.main import app
    from app.models.documents import Document
    from app.models.transactions import Merchant, Transaction

    session_factory = async_sessionmaker(bind=engine, expire_on_commit=False)
    shared_store = ObjectStore(_settings(), client=FakeBoto())

    async def _override_session():
        async with session_factory() as s:
            yield s

    monkeypatch.setattr(service, "enqueue_ocr", lambda did: None)
    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_object_store] = lambda: shared_store
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            email = f"{uuid.uuid4().hex[:12]}@example.com"
            su = await c.post(
                "/auth/signup",
                json={
                    "email": email, "password": "hunter2pass", "display_name": "Owner",
                    "workspace_name": f"{HOUSEHOLD_PREFIX}prov",
                },
            )
            assert su.status_code == 201, su.text
            auth = {"Authorization": f"Bearer {su.json()['access_token']}"}

            up = await c.post(
                "/documents", headers=auth,
                files={"file": ("r.csv", b"Date,Desc,Amount\n2026-01-01,x,1.00\n", "text/csv")},
            )
            assert up.status_code == 201, up.text
            doc_id = uuid.UUID(up.json()["id"])

            # A document with no transactions yet reports an empty provenance list.
            pre = await c.get("/documents", headers=auth)
            pre_row = next(d for d in pre.json() if d["id"] == str(doc_id))
            assert pre_row["transactions"] == []

            # Link a transaction to the document (as confirm/ingest would).
            async with session_factory() as s:
                doc = await s.get(Document, doc_id)
                merchant = Merchant(household_id=doc.household_id, canonical_name="Trader Joe's")
                s.add(merchant)
                await s.flush()
                from datetime import date as _date
                s.add(Transaction(
                    household_id=doc.household_id,
                    merchant_id=merchant.id,
                    amount="42.10", currency="USD", txn_date=_date(2026, 6, 1),
                    status="draft", source_document_id=doc.id, source_channel="upload",
                ))
                await s.commit()

            resp = await c.get("/documents", headers=auth)
            assert resp.status_code == 200
            row = next(d for d in resp.json() if d["id"] == str(doc_id))
            assert len(row["transactions"]) == 1
            assert row["transactions"][0]["merchant"] == "Trader Joe's"
            assert row["transactions"][0]["amount"] == "42.10"
            assert row["transactions"][0]["currency"] == "USD"
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_create_document_persists_batch_id():
    fake = FakeBoto()
    session = FakeSession()
    doc = await service.create_document(
        session, _store(fake),
        household_id=HID, uploaded_by_user_id=UID,
        file_bytes=png_bytes(), filename="receipt.png", content_type="image/png",
        batch_id="batch-123",
        settings=_settings(),
    )
    assert doc.ocr_meta["ingest"]["batch_id"] == "batch-123"


@pytest.mark.asyncio
async def test_create_document_persists_group_hint():
    fake = FakeBoto()
    session = FakeSession()
    doc = await service.create_document(
        session, _store(fake),
        household_id=HID, uploaded_by_user_id=UID,
        file_bytes=png_bytes(), filename="receipt.png", content_type="image/png",
        batch_id="batch-123",
        group_hint="single",
        settings=_settings(),
    )
    assert doc.ocr_meta["ingest"]["group_hint"] == "single"


@pytest.mark.asyncio
async def test_create_document_without_batch_id_omits_key():
    fake = FakeBoto()
    session = FakeSession()
    doc = await service.create_document(
        session, _store(fake),
        household_id=HID, uploaded_by_user_id=UID,
        file_bytes=png_bytes(), filename="receipt.png", content_type="image/png",
        settings=_settings(),
    )
    assert "batch_id" not in doc.ocr_meta["ingest"]
