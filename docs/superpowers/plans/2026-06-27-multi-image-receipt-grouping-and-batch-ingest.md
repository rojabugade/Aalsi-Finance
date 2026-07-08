# Multi-Image Receipt Grouping & Batch Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-detect when images uploaded in one batch are the same receipt and propose a user-confirmed merge, while queuing multiple spreadsheets instead of silently dropping them.

**Architecture:** A client-minted `batch_id` rides existing `ocr_meta["ingest"]` JSONB (no migration). The review-queue endpoint groups `needs_review` documents at read time via pure functions in a new `app/ocr/grouping.py` — clustering same-batch receipts by canonical merchant, but only when their totals don't conflict. The user confirms or splits a suggested group; confirm merges field-by-field and ingests one transaction. The spreadsheet fix is local frontend queue state.

**Tech Stack:** FastAPI + SQLAlchemy async (Postgres), Pydantic v2, pytest/pytest-asyncio (backend); Next.js + React + TanStack Query + Dexie + vitest (frontend); openapi-typescript for the shared schema.

## Global Constraints

- No DB schema / migration changes — everything rides existing `ocr_meta` JSONB.
- Money stays as strings in `ocr_meta["ocr"]["data"]`; parse via `app.ocr.normalize.to_amount` for comparison only.
- All merges are user-confirmed; never auto-commit a merged transaction.
- Detection scope is a single upload batch; never group across batches.
- Group only `type in {"receipt", "invoice"}`; everything else stays loose.
- The existing per-document path (`resolve_review`, `POST /review-queue/{id}/resolve`) must remain untouched and working.
- Backend pure-function tests must not require Postgres. Endpoint/DB tests skip when Postgres is absent (`TEST_DATABASE_URL`, default `postgresql+asyncpg://finance:finance@localhost:5433/finance`).

---

## File Structure

**Backend**
- `backend/app/ocr/grouping.py` — NEW. Pure functions: `merge_extractions`, `group_review_documents`, plus the `ReviewGroup` dataclass. No I/O.
- `backend/app/ocr/schemas.py` — MODIFY. Add `batch_id` to `ReviewItemOut`; add `ReviewGroupOut`, `ReviewQueueOut`, `ResolveGroupIn`.
- `backend/app/ocr/router.py` — MODIFY. `GET /review-queue` returns `ReviewQueueOut`; add `POST /review-queue/group/resolve`.
- `backend/app/ocr/service.py` — MODIFY. Add `resolve_group(...)`.
- `backend/app/documents/router.py` — MODIFY. Add `batch_id` Form field.
- `backend/app/documents/service.py` — MODIFY. Thread `batch_id` into `ingest_meta`.
- `backend/tests/test_ocr_grouping.py` — NEW. Pure-function tests (no DB).
- `backend/tests/test_m4_documents.py` — MODIFY. Add a `batch_id` persistence unit test.
- `backend/tests/test_m5_ocr.py` — MODIFY. Add `resolve_group` DB tests.

**Frontend**
- `web/lib/offline/db.ts` — MODIFY. Add optional `batchId` to `QueuedCapture`.
- `web/lib/offline/sync.ts` — MODIFY. Forward `batchId` as `batch_id` form part.
- `web/app/(app)/capture/page.tsx` — MODIFY. Mint one `batchId` per ingest; spreadsheet queue; render groups.
- `web/components/capture/csv-wizard.tsx` — MODIFY. Add `onDone` callback.
- `web/components/capture/suggested-group-card.tsx` — NEW. Group confirm/split card.
- `web/lib/api/review.ts` — MODIFY. Grouped response type + `useResolveGroup`.
- `shared/api-schema.ts` — REGENERATE from the live backend.
- `web/components/capture/__tests__/suggested-group-card.test.tsx` — NEW.
- `web/app/(app)/capture/__tests__/spreadsheet-queue.test.tsx` — NEW (or fold into existing capture test if present).

---

## Task 1: `merge_extractions` pure function

**Files:**
- Create: `backend/app/ocr/grouping.py`
- Test: `backend/tests/test_ocr_grouping.py`

**Interfaces:**
- Consumes: `app.ocr.normalize.to_amount` (existing: `to_amount(value) -> Decimal | None`).
- Produces:
  - `merge_extractions(members: list) -> tuple[dict, dict]` — `members` are objects with a `.ocr_meta` dict; returns `(merged_data, merged_summary)`. `merged_data` has receipt keys `merchant,date,currency,subtotal,tax,total,line_items`. `merged_summary` has `merchant,total,currency,date,line_item_count`.

Each member's extracted payload lives at `member.ocr_meta["ocr"]["data"]`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_ocr_grouping.py
from __future__ import annotations

from types import SimpleNamespace

from app.ocr.grouping import merge_extractions


def _doc(doc_id, merchant=None, total=None, date=None, currency=None,
         subtotal=None, tax=None, line_items=None, doc_type="receipt"):
    return SimpleNamespace(
        id=doc_id,
        type=doc_type,
        ocr_meta={
            "ingest": {"batch_id": "b1"},
            "ocr": {
                "doc_type": doc_type,
                "data": {
                    "merchant": merchant,
                    "date": date,
                    "currency": currency,
                    "subtotal": subtotal,
                    "tax": tax,
                    "total": total,
                    "line_items": line_items or [],
                },
                "confidence": 0.5,
                "summary": {},
            },
        },
    )


def test_merge_unions_complementary_fields():
    a = _doc("a", merchant="Walmart", line_items=[{"name": "Milk", "amount": "3.00"}])
    b = _doc("b", merchant=None, total="42.10", date="2026-06-27", currency="USD",
             line_items=[{"name": "Eggs", "amount": "5.00"}])
    data, summary = merge_extractions([a, b])
    assert data["merchant"] == "Walmart"   # first non-null
    assert data["total"] == "42.10"        # only non-null total
    assert data["date"] == "2026-06-27"
    assert data["currency"] == "USD"
    assert [li["name"] for li in data["line_items"]] == ["Milk", "Eggs"]  # concatenated
    assert summary["merchant"] == "Walmart"
    assert summary["total"] == "42.10"
    assert summary["line_item_count"] == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_ocr_grouping.py::test_merge_unions_complementary_fields -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.ocr.grouping'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/ocr/grouping.py
"""Read-time same-receipt grouping for the review queue (pure, no I/O).

Within a single upload batch we cluster receipt/invoice documents by canonical
merchant and propose a merge — but only when their totals don't conflict. The
total conflict is what separates "one receipt photographed twice" from "two
different trips uploaded together". Nothing here touches the DB; callers pass
in already-loaded document objects and persist the outcome themselves.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.ocr import normalize


def _data(document) -> dict:
    return ((document.ocr_meta or {}).get("ocr", {}) or {}).get("data", {}) or {}


def _first_non_null(members, key):
    for m in members:
        value = _data(m).get(key)
        if value is not None and value != "":
            return value
    return None


def merge_extractions(members: list) -> tuple[dict, dict]:
    """Field-union the members' extracted receipt payloads into one.

    merchant/date/currency/subtotal/tax/total -> first non-null in member order
    (the no-conflict rule upstream guarantees totals don't disagree).
    line_items -> concatenation across all members.
    """
    line_items: list = []
    for m in members:
        line_items.extend(_data(m).get("line_items") or [])

    data = {
        "merchant": _first_non_null(members, "merchant"),
        "date": _first_non_null(members, "date"),
        "currency": _first_non_null(members, "currency"),
        "subtotal": _first_non_null(members, "subtotal"),
        "tax": _first_non_null(members, "tax"),
        "total": _first_non_null(members, "total"),
        "line_items": line_items,
    }
    summary = {
        "merchant": data["merchant"],
        "total": data["total"],
        "currency": data["currency"],
        "date": data["date"],
        "line_item_count": len(line_items),
    }
    return data, summary
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_ocr_grouping.py::test_merge_unions_complementary_fields -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/ocr/grouping.py backend/tests/test_ocr_grouping.py
git commit -m "feat(ocr): merge_extractions field-unions same-receipt payloads"
```

---

## Task 2: `group_review_documents` pure function

**Files:**
- Modify: `backend/app/ocr/grouping.py`
- Test: `backend/tests/test_ocr_grouping.py`

**Interfaces:**
- Consumes: `merge_extractions` (Task 1); `app.ocr.normalize.canonical_merchant` (existing: `canonical_merchant(raw: str | None) -> str | None`), `app.ocr.normalize.to_amount`.
- Produces:
  - `ReviewGroup` dataclass: `member_ids: list[str]`, `data: dict`, `summary: dict`, `doc_type: str`, `confidence: float`.
  - `group_review_documents(documents: list) -> tuple[list[ReviewGroup], list]` — `documents` are objects with `.id`, `.type`, `.ocr_meta`; returns `(groups, loose_documents)`. `member_ids[0]` is the primary (lowest first by input order). `loose_documents` preserves input order.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/tests/test_ocr_grouping.py
from app.ocr.grouping import group_review_documents, ReviewGroup


def test_groups_same_merchant_complementary_batch():
    a = _doc("a", merchant="Walmart")
    b = _doc("b", merchant="Walmart", total="42.10")
    groups, loose = group_review_documents([a, b])
    assert len(groups) == 1
    assert isinstance(groups[0], ReviewGroup)
    assert groups[0].member_ids == ["a", "b"]
    assert groups[0].data["total"] == "42.10"
    assert loose == []


def test_conflicting_totals_stay_loose():
    a = _doc("a", merchant="Walmart", total="10.00")
    b = _doc("b", merchant="Walmart", total="99.00")  # different trip
    groups, loose = group_review_documents([a, b])
    assert groups == []
    assert {d.id for d in loose} == {"a", "b"}


def test_different_merchants_not_grouped():
    a = _doc("a", merchant="Walmart", total="10.00")
    b = _doc("b", merchant="Target", total="20.00")
    groups, loose = group_review_documents([a, b])
    assert groups == []
    assert len(loose) == 2


def test_different_batches_never_group():
    a = _doc("a", merchant="Walmart")
    b = _doc("b", merchant="Walmart", total="42.10")
    b.ocr_meta["ingest"]["batch_id"] = "other-batch"
    groups, loose = group_review_documents([a, b])
    assert groups == []
    assert len(loose) == 2


def test_missing_batch_id_is_loose():
    a = _doc("a", merchant="Walmart")
    a.ocr_meta["ingest"].pop("batch_id")
    b = _doc("b", merchant="Walmart", total="42.10")
    b.ocr_meta["ingest"].pop("batch_id")
    groups, loose = group_review_documents([a, b])
    assert groups == []
    assert len(loose) == 2


def test_statement_and_csv_stay_loose():
    a = _doc("a", merchant="Walmart")
    s = _doc("s", merchant=None, doc_type="statement")
    groups, loose = group_review_documents([a, s])
    assert groups == []          # a is alone in its cluster, s isn't groupable
    assert {d.id for d in loose} == {"a", "s"}


def test_agreeing_totals_group():
    a = _doc("a", merchant="Walmart", total="42.10")
    b = _doc("b", merchant="Walmart", total="42.10")  # both pages show the total
    groups, loose = group_review_documents([a, b])
    assert len(groups) == 1
    assert groups[0].data["total"] == "42.10"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_ocr_grouping.py -k group -v`
Expected: FAIL with `ImportError: cannot import name 'group_review_documents'`

- [ ] **Step 3: Write minimal implementation**

Append to `backend/app/ocr/grouping.py`:

```python
@dataclass
class ReviewGroup:
    member_ids: list[str]
    data: dict
    summary: dict
    doc_type: str
    confidence: float = 0.0


_GROUPABLE_TYPES = {"receipt", "invoice"}


def _batch_id(document) -> str | None:
    return ((document.ocr_meta or {}).get("ingest", {}) or {}).get("batch_id")


def _ocr_confidence(document) -> float:
    return float(((document.ocr_meta or {}).get("ocr", {}) or {}).get("confidence", 0.0) or 0.0)


def _totals_conflict(members) -> bool:
    distinct = set()
    for m in members:
        amount = normalize.to_amount(_data(m).get("total"))
        if amount is not None:
            distinct.add(amount)
    return len(distinct) >= 2


def group_review_documents(documents: list) -> tuple[list[ReviewGroup], list]:
    """Split needs_review documents into suggested same-receipt groups + loose docs."""
    # Bucket groupable docs by (batch_id, canonical merchant); preserve input order.
    buckets: dict[tuple[str, str], list] = {}
    groupable_ids: set = set()
    for doc in documents:
        if doc.type not in _GROUPABLE_TYPES:
            continue
        batch = _batch_id(doc)
        merchant = normalize.canonical_merchant(_data(doc).get("merchant"))
        if not batch or not merchant:
            continue
        buckets.setdefault((batch, merchant), []).append(doc)
        groupable_ids.add(doc.id)

    groups: list[ReviewGroup] = []
    grouped_ids: set = set()
    for members in buckets.values():
        if len(members) < 2 or _totals_conflict(members):
            continue
        data, summary = merge_extractions(members)
        groups.append(
            ReviewGroup(
                member_ids=[str(m.id) for m in members],
                data=data,
                summary=summary,
                doc_type=members[0].type,
                confidence=min(_ocr_confidence(m) for m in members),
            )
        )
        grouped_ids.update(m.id for m in members)

    loose = [d for d in documents if d.id not in grouped_ids]
    return groups, loose
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_ocr_grouping.py -v`
Expected: PASS (all tests, including Task 1's)

- [ ] **Step 5: Commit**

```bash
git add backend/app/ocr/grouping.py backend/tests/test_ocr_grouping.py
git commit -m "feat(ocr): group_review_documents clusters same-batch receipts safely"
```

---

## Task 3: Persist `batch_id` through document upload

**Files:**
- Modify: `backend/app/documents/service.py:115-135` (the `ingest_meta` dict + `create_document` signature)
- Modify: `backend/app/documents/router.py:73-99` (the `upload_document` Form params + call)
- Test: `backend/tests/test_m4_documents.py`

**Interfaces:**
- Produces: `create_document(..., batch_id: str | None = None)` stores `ingest_meta["batch_id"]` when provided. `POST /documents` accepts a `batch_id` multipart form field.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/tests/test_m4_documents.py (uses existing FakeBoto/FakeSession/_store/_settings/png_bytes/HID/UID)
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_m4_documents.py::test_create_document_persists_batch_id -v`
Expected: FAIL with `TypeError: create_document() got an unexpected keyword argument 'batch_id'`

- [ ] **Step 3: Write minimal implementation**

In `backend/app/documents/service.py`, add the parameter to `create_document`'s signature (after `source_label: str | None = None,`):

```python
    source_label: str | None = None,
    batch_id: str | None = None,
```

And after the existing `if source_label:` block (around line 124-125):

```python
    if source_label:
        ingest_meta["source_label"] = source_label
    if batch_id:
        ingest_meta["batch_id"] = batch_id
```

In `backend/app/documents/router.py`, add the Form field to `upload_document` (after `source_label: str | None = Form(default=None),`):

```python
    source_label: str | None = Form(default=None),
    batch_id: str | None = Form(default=None),
```

And pass it in the `service.create_document(...)` call (after `source_label=source_label,`):

```python
            source_label=source_label,
            batch_id=batch_id,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_m4_documents.py -k batch_id -v`
Expected: PASS (both new tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/documents/service.py backend/app/documents/router.py backend/tests/test_m4_documents.py
git commit -m "feat(documents): accept and persist batch_id on upload"
```

---

## Task 4: Grouped review-queue response

**Files:**
- Modify: `backend/app/ocr/schemas.py` (add `batch_id` to `ReviewItemOut`; add `ReviewGroupOut`, `ReviewQueueOut`)
- Modify: `backend/app/ocr/router.py` (`_to_review_out` sets `batch_id`; `GET /review-queue` returns `ReviewQueueOut`)
- Test: `backend/tests/test_ocr_grouping.py`

**Interfaces:**
- Consumes: `group_review_documents` (Task 2).
- Produces:
  - `ReviewItemOut.batch_id: str | None`
  - `ReviewGroupOut(member_document_ids: list[str], suggested: ReviewItemOut, members: list[ReviewItemOut])`
  - `ReviewQueueOut(groups: list[ReviewGroupOut], items: list[ReviewItemOut])`
  - `build_review_queue(documents: list) -> ReviewQueueOut` helper in `router.py` (tested directly without a server).

- [ ] **Step 1: Write the failing test**

```python
# append to backend/tests/test_ocr_grouping.py
from app.ocr.router import build_review_queue


def test_build_review_queue_separates_groups_and_loose():
    a = _doc("a", merchant="Walmart")
    b = _doc("b", merchant="Walmart", total="42.10")
    c = _doc("c", merchant="Target", total="20.00")
    for d in (a, b, c):
        d.status = "needs_review"
    out = build_review_queue([a, b, c])
    assert len(out.groups) == 1
    grp = out.groups[0]
    assert grp.member_document_ids == ["a", "b"]
    assert grp.suggested.summary["total"] == "42.10"
    assert grp.suggested.batch_id == "b1"
    assert {m.document_id for m in grp.members} == {"a", "b"}
    assert [i.document_id for i in out.items] == ["c"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_ocr_grouping.py::test_build_review_queue_separates_groups_and_loose -v`
Expected: FAIL with `ImportError: cannot import name 'build_review_queue'`

- [ ] **Step 3: Write minimal implementation**

In `backend/app/ocr/schemas.py`, add `batch_id` to `ReviewItemOut`:

```python
class ReviewItemOut(BaseModel):
    document_id: str
    type: str
    status: str
    confidence: float | None = None
    summary: dict | None = None
    data: dict | None = None
    reasons: list[str] = Field(default_factory=list)
    batch_id: str | None = None
```

And add, after `ReviewItemOut`:

```python
class ReviewGroupOut(BaseModel):
    member_document_ids: list[str]
    suggested: ReviewItemOut
    members: list[ReviewItemOut]


class ReviewQueueOut(BaseModel):
    groups: list[ReviewGroupOut] = Field(default_factory=list)
    items: list[ReviewItemOut] = Field(default_factory=list)
```

In `backend/app/ocr/router.py`, update imports and `_to_review_out`, add `build_review_queue`, and change the endpoint:

```python
from app.ocr.grouping import ReviewGroup, group_review_documents
from app.ocr.schemas import (
    ResolveIn,
    ReviewGroupOut,
    ReviewItemOut,
    ReviewQueueOut,
)


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
```

> Note: `_doc(...)` in the test sets `.id` to a plain string like `"a"`, so `str(d.id)` keys match `member_ids`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_ocr_grouping.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/ocr/schemas.py backend/app/ocr/router.py backend/tests/test_ocr_grouping.py
git commit -m "feat(ocr): review-queue returns grouped + loose shape"
```

---

## Task 5: Group confirm / split endpoint

**Files:**
- Modify: `backend/app/ocr/schemas.py` (add `ResolveGroupIn`)
- Modify: `backend/app/ocr/service.py` (add `resolve_group`)
- Modify: `backend/app/ocr/router.py` (add `POST /review-queue/group/resolve`)
- Test: `backend/tests/test_m5_ocr.py`

**Interfaces:**
- Consumes: `app.ocr.grouping.merge_extractions` (Task 1); existing `service._handoff_to_m6`, `app.auth.deps.scoped_query`, `ExtractionResult`.
- Produces:
  - `ResolveGroupIn(member_document_ids: list[str], action: Literal["confirm","split"], data: dict | None = None)`
  - `service.resolve_group(session, user, member_document_ids: list[uuid.UUID], data: dict | None) -> Document | None` — merges survivors, ingests one transaction, marks the primary `processed`, marks the rest `processed` with `ocr_meta["ocr"]["merged_into"]`. Returns the primary `Document`, or `None` if no member is still `needs_review`.
  - `POST /review-queue/group/resolve` returns the primary `ReviewItemOut` (confirm) or 200 with the unchanged members on split.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/tests/test_m5_ocr.py (uses existing db_session fixture + _user helper)
import uuid as _uuid

from app.models.documents import Document
from app.ocr.schemas import ResolveGroupIn


def _needs_review_receipt(user, batch_id, merchant, total, line_items):
    return Document(
        id=_uuid.uuid4(),
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
                "data": {"merchant": merchant, "total": total, "currency": "USD",
                         "date": "2026-06-27", "subtotal": None, "tax": None,
                         "line_items": line_items},
                "confidence": 0.5,
                "needs_review": True,
                "summary": {"merchant": merchant, "total": total},
                "engine": {}, "reasons": [],
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

    monkeypatch.setattr("app.ocr.service._handoff_to_m6",
                        lambda *a, **k: _async_true())

    primary = await service.resolve_group(db_session, user, [a.id, b.id], None)
    assert primary is not None and primary.id == a.id
    assert primary.status == "processed"


async def _async_true():
    return True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_m5_ocr.py::test_resolve_group_merges_and_marks_members -v`
Expected: FAIL with `AttributeError: module 'app.ocr.service' has no attribute 'resolve_group'` (or skip if no Postgres)

- [ ] **Step 3: Write minimal implementation**

In `backend/app/ocr/schemas.py`, after `ResolveIn`:

```python
class ResolveGroupIn(BaseModel):
    member_document_ids: list[str]
    action: Literal["confirm", "split"]
    data: dict | None = None
```

In `backend/app/ocr/service.py`, add near the top of the imports:

```python
from app.ocr.grouping import merge_extractions
```

And add this function after `resolve_review`:

```python
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
```

In `backend/app/ocr/router.py`, add `ResolveGroupIn` to the schemas import and add the endpoint:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_m5_ocr.py -k resolve_group -v`
Expected: PASS (or skipped if no Postgres at `TEST_DATABASE_URL`)

- [ ] **Step 5: Commit**

```bash
git add backend/app/ocr/schemas.py backend/app/ocr/service.py backend/app/ocr/router.py backend/tests/test_m5_ocr.py
git commit -m "feat(ocr): group resolve merges survivors into one transaction"
```

---

## Task 6: Regenerate shared schema + frontend review API

**Files:**
- Regenerate: `shared/api-schema.ts`
- Modify: `web/lib/api/review.ts`

**Interfaces:**
- Consumes: backend `ReviewQueueOut`, `ReviewGroupOut`, `ResolveGroupIn` (Tasks 4-5).
- Produces:
  - `ReviewQueue = components["schemas"]["ReviewQueueOut"]`, `ReviewGroup = components["schemas"]["ReviewGroupOut"]`, `ReviewItem` unchanged.
  - `useReviewQueue` now returns `ReviewQueue` (`{groups, items}`).
  - `useResolveGroup()` mutation hitting `POST /review-queue/group/resolve`.

- [ ] **Step 1: Regenerate the schema from the running backend**

Start the backend (e.g. `docker compose -f docker-compose.dev.yml up -d api` or the project's usual way), then:

Run: `cd web && npm run gen:api`
Expected: `shared/api-schema.ts` now contains `ReviewQueueOut`, `ReviewGroupOut`, `ResolveGroupIn`, and a `batch_id` field on `ReviewItemOut`. Confirm:

Run: `grep -n "ReviewQueueOut\|ReviewGroupOut\|ResolveGroupIn\|group/resolve" ../shared/api-schema.ts`
Expected: matches found.

- [ ] **Step 2: Write the failing test (review API types compile + mutation shape)**

```ts
// web/lib/api/__tests__/review-types.test.ts
import { describe, it, expectTypeOf } from "vitest";
import type { ReviewQueue } from "@/lib/api/review";

describe("review queue type", () => {
  it("has groups and items", () => {
    expectTypeOf<ReviewQueue>().toHaveProperty("groups");
    expectTypeOf<ReviewQueue>().toHaveProperty("items");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run lib/api/__tests__/review-types.test.ts`
Expected: FAIL — `ReviewQueue` is not exported from `@/lib/api/review`.

- [ ] **Step 4: Update `web/lib/api/review.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";

export type ReviewItem = components["schemas"]["ReviewItemOut"];
export type ReviewGroup = components["schemas"]["ReviewGroupOut"];
export type ReviewQueue = components["schemas"]["ReviewQueueOut"];
export type ResolveAction = "confirm" | "reject";

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

const KEY = ["review-queue"] as const;

/** Suggested same-receipt groups + loose items awaiting confirmation. */
export function useReviewQueue(opts?: { poll?: boolean }) {
  return useQuery<ReviewQueue>({
    queryKey: KEY,
    queryFn: () => unwrap(api.GET("/review-queue", {})),
    refetchInterval: opts?.poll ? 2500 : false,
  });
}

export function useResolveReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      documentId,
      action,
      data,
    }: {
      documentId: string;
      action: ResolveAction;
      data?: Record<string, unknown> | null;
    }) =>
      unwrap(
        api.POST("/review-queue/{document_id}/resolve", {
          params: { path: { document_id: documentId } },
          body: { action, data: (data ?? null) as Record<string, never> | null },
        }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

/** Confirm or split a suggested same-receipt group. */
export function useResolveGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      memberDocumentIds,
      action,
      data,
    }: {
      memberDocumentIds: string[];
      action: "confirm" | "split";
      data?: Record<string, unknown> | null;
    }) =>
      unwrap(
        api.POST("/review-queue/group/resolve", {
          body: {
            member_document_ids: memberDocumentIds,
            action,
            data: (data ?? null) as Record<string, never> | null,
          },
        }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run lib/api/__tests__/review-types.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add shared/api-schema.ts web/lib/api/review.ts web/lib/api/__tests__/review-types.test.ts
git commit -m "feat(web): grouped review-queue types + useResolveGroup"
```

---

## Task 7: Thread `batchId` through offline upload

**Files:**
- Modify: `web/lib/offline/db.ts`
- Modify: `web/lib/offline/sync.ts`
- Modify: `web/app/(app)/capture/page.tsx:37-58` (`ingest`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `QueuedCapture.batchId?: string`; `enqueueCapture(file, {..., batchId?})`; `uploadDocument(file, {..., batchId?})` sends `batch_id`. `ingest()` mints one `batchId` per call.

- [ ] **Step 1: Add `batchId` to the Dexie type**

In `web/lib/offline/db.ts`, add to the `QueuedCapture` interface (after `sourceLabel?: string;`):

```ts
  sourceLabel?: string;
  /** Groups files uploaded together so the server can detect same-receipt images. */
  batchId?: string;
```

(No Dexie store-version bump needed: `batchId` is an unindexed optional field.)

- [ ] **Step 2: Forward `batchId` in `sync.ts`**

In `web/lib/offline/sync.ts`, update `uploadDocument`'s `opts` type and body, and `enqueueCapture`'s `opts` + item:

```ts
export async function uploadDocument(
  file: Blob,
  opts: { filename: string; docType?: string; sourceLabel?: string; batchId?: string },
): Promise<UploadResult> {
```

After the existing `if (opts.sourceLabel) form.append("source_label", opts.sourceLabel);`:

```ts
  if (opts.sourceLabel) form.append("source_label", opts.sourceLabel);
  if (opts.batchId) form.append("batch_id", opts.batchId);
```

```ts
export async function enqueueCapture(
  file: Blob,
  opts: { filename: string; docType?: string; sourceLabel?: string; batchId?: string },
): Promise<QueuedCapture> {
  const item: QueuedCapture = {
    id: crypto.randomUUID(),
    blob: file,
    filename: opts.filename,
    contentType: file.type || "application/octet-stream",
    docType: opts.docType ?? "",
    sourceLabel: opts.sourceLabel,
    batchId: opts.batchId,
    createdAt: Date.now(),
    attempts: 0,
    status: "queued",
  };
  await db.captures.add(item);
  return item;
}
```

Find where `flushQueue` calls `uploadDocument` and pass the item's `batchId`:

Run: `grep -n "uploadDocument(" web/lib/offline/sync.ts`
Then in that call, add `batchId: item.batchId` to the opts object alongside `filename`, `docType`, `sourceLabel`.

- [ ] **Step 3: Mint one `batchId` per ingest call**

In `web/app/(app)/capture/page.tsx`, inside `ingest`, after `setBusy(true);`:

```ts
    setBusy(true);
    const batchId = crypto.randomUUID();
    try {
      for (const file of docs) {
        await enqueueCapture(file, { filename: file.name, batchId }); // no docType → auto-detect
      }
```

- [ ] **Step 4: Verify typecheck passes**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/lib/offline/db.ts web/lib/offline/sync.ts "web/app/(app)/capture/page.tsx"
git commit -m "feat(web): tag uploads with a per-batch id for receipt grouping"
```

---

## Task 8: Suggested-group card + grouped render

**Files:**
- Create: `web/components/capture/suggested-group-card.tsx`
- Modify: `web/app/(app)/capture/page.tsx` (`ReviewQueueInline`)
- Test: `web/components/capture/__tests__/suggested-group-card.test.tsx`

**Interfaces:**
- Consumes: `ReviewGroup`, `useResolveGroup`, `useResolveReview` (Task 6); `ConfirmCard` (existing).
- Produces: `SuggestedGroupCard({ group, onConfirm, onSplitResolve, pending })` where `onConfirm(memberIds: string[])` and `onSplitResolve(documentId, action, data?)`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/capture/__tests__/suggested-group-card.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SuggestedGroupCard } from "@/components/capture/suggested-group-card";
import type { ReviewGroup } from "@/lib/api/review";

const group: ReviewGroup = {
  member_document_ids: ["a", "b"],
  suggested: {
    document_id: "a", type: "receipt", status: "needs_review",
    confidence: 0.5, summary: { merchant: "Walmart", total: "42.10" },
    data: { merchant: "Walmart", total: "42.10" }, reasons: [], batch_id: "b1",
  },
  members: [
    { document_id: "a", type: "receipt", status: "needs_review", summary: {}, data: { merchant: "Walmart" }, reasons: [], batch_id: "b1", confidence: 0.5 },
    { document_id: "b", type: "receipt", status: "needs_review", summary: {}, data: { total: "42.10" }, reasons: [], batch_id: "b1", confidence: 0.5 },
  ],
};

describe("SuggestedGroupCard", () => {
  it("confirms the whole group with member ids", () => {
    const onConfirm = vi.fn();
    render(<SuggestedGroupCard group={group} pending={false} onConfirm={onConfirm} onSplitResolve={vi.fn()} />);
    expect(screen.getByText(/Walmart/)).toBeTruthy();
    expect(screen.getByText(/from 2 images/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalledWith(["a", "b"]);
  });

  it("expands to individual cards on split", () => {
    render(<SuggestedGroupCard group={group} pending={false} onConfirm={vi.fn()} onSplitResolve={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /split apart/i }));
    // Two ConfirmCards now visible — each has its own confirm control.
    expect(screen.getAllByRole("button", { name: /confirm/i }).length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/capture/__tests__/suggested-group-card.test.tsx`
Expected: FAIL — module `suggested-group-card` not found.

- [ ] **Step 3: Implement `SuggestedGroupCard`**

```tsx
// web/components/capture/suggested-group-card.tsx
"use client";

import { useState } from "react";
import { Layers, CheckCircle2, Scissors } from "lucide-react";
import type { ReviewGroup, ResolveAction } from "@/lib/api/review";
import { Button } from "@/components/ui/button";
import { ConfirmCard } from "./confirm-card";

type Data = Record<string, unknown>;

export function SuggestedGroupCard({
  group,
  pending,
  onConfirm,
  onSplitResolve,
}: {
  group: ReviewGroup;
  pending: boolean;
  onConfirm: (memberIds: string[]) => void | Promise<void>;
  onSplitResolve: (documentId: string, action: ResolveAction, data?: Data) => Promise<void>;
}) {
  const [split, setSplit] = useState(false);
  const s = (group.suggested.summary ?? {}) as Data;
  const merchant = String(s.merchant ?? "Receipt");
  const total = s.total != null ? String(s.total) : "—";
  const count = group.member_document_ids.length;

  if (split) {
    return (
      <li className="space-y-2 rounded-lg border border-accent/40 bg-accent/5 p-2">
        <p className="px-1 text-xs text-muted">Splitting group — confirm each item on its own.</p>
        {group.members.map((m) => (
          <ConfirmCard
            key={m.document_id}
            item={m}
            pending={pending}
            onResolve={(action, data) => onSplitResolve(m.document_id, action, data)}
          />
        ))}
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-accent/50 bg-accent/5 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Layers className="size-4 text-accent" /> {merchant} · {total}
          </p>
          <p className="text-xs text-muted">Looks like one receipt — from {count} images</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" disabled={pending} onClick={() => onConfirm(group.member_document_ids)}>
            <CheckCircle2 className="size-4" /> Confirm
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setSplit(true)}>
            <Scissors className="size-4" /> Split apart
          </Button>
        </div>
      </div>
    </li>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/capture/__tests__/suggested-group-card.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire it into `ReviewQueueInline`**

In `web/app/(app)/capture/page.tsx`, update the imports and `ReviewQueueInline`. Replace the `useReviewQueue`/render block:

```tsx
import { useReviewQueue, useResolveReview, useResolveGroup } from "@/lib/api/review";
import { ConfirmCard } from "@/components/capture/confirm-card";
import { SuggestedGroupCard } from "@/components/capture/suggested-group-card";
```

```tsx
function ReviewQueueInline({ poll }: { poll: boolean }) {
  const queue = useReviewQueue({ poll });
  const resolve = useResolveReview();
  const resolveGroup = useResolveGroup();
  const groups = queue.data?.groups ?? [];
  const items = queue.data?.items ?? [];

  async function act(documentId: string, action: "confirm" | "reject", data?: Record<string, unknown>) {
    try {
      await resolve.mutateAsync({ documentId, action, data });
      toast.success(action === "confirm" ? "Confirmed" : "Rejected");
    } catch {
      toast.error("Couldn't update that item");
    }
  }

  async function confirmGroup(memberIds: string[]) {
    try {
      await resolveGroup.mutateAsync({ memberDocumentIds: memberIds, action: "confirm" });
      toast.success("Merged receipt confirmed");
    } catch {
      toast.error("Couldn't merge those images");
    }
  }

  const empty = groups.length === 0 && items.length === 0;

  return (
    <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="mb-3">
        <h2 className="text-base font-bold tracking-tight">Confirm to add</h2>
        <p className="text-sm text-muted">Detected items wait here until you confirm them as transactions.</p>
      </div>
      {empty ? (
        <p className="py-6 text-center text-sm text-muted">Nothing waiting to confirm.</p>
      ) : (
        <ul className="space-y-2">
          {groups.map((g) => (
            <SuggestedGroupCard
              key={g.member_document_ids.join("-")}
              group={g}
              pending={resolveGroup.isPending || resolve.isPending}
              onConfirm={confirmGroup}
              onSplitResolve={act}
            />
          ))}
          {items.map((item) => (
            <ConfirmCard
              key={item.document_id}
              item={item}
              pending={resolve.isPending}
              onResolve={(action, data) => act(item.document_id, action, data)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Verify typecheck + capture tests pass**

Run: `cd web && npx tsc --noEmit && npx vitest run components/capture`
Expected: no type errors; capture tests pass.

- [ ] **Step 7: Commit**

```bash
git add web/components/capture/suggested-group-card.tsx web/components/capture/__tests__/suggested-group-card.test.tsx "web/app/(app)/capture/page.tsx"
git commit -m "feat(web): render suggested same-receipt groups with confirm/split"
```

---

## Task 9: Spreadsheet queue (map multiple, drop none)

**Files:**
- Modify: `web/app/(app)/capture/page.tsx` (`spreadsheet` state → `sheets: File[]`, `ingest`, the wizard panel)
- Modify: `web/components/capture/csv-wizard.tsx` (add `onDone`)
- Test: `web/app/(app)/capture/__tests__/spreadsheet-queue.test.tsx`

**Interfaces:**
- Consumes: `CsvWizard` (existing `initialFile` prop).
- Produces: `CsvWizard({ initialFile?, onDone? })`; `onDone()` fires after a sheet is mapped or skipped. `CapturePage` keeps a FIFO `sheets` queue.

- [ ] **Step 1: Write the failing test**

```tsx
// web/app/(app)/capture/__tests__/spreadsheet-queue.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Stub CsvWizard so the test exercises only the queue advancement.
vi.mock("@/components/capture/csv-wizard", () => ({
  isSpreadsheetFile: (f: File) => /\.(csv|xlsx)$/i.test(f.name),
  CsvWizard: ({ initialFile, onDone }: { initialFile?: File; onDone?: () => void }) => (
    <div>
      <span>mapping:{initialFile?.name}</span>
      <button onClick={() => onDone?.()}>finish-sheet</button>
    </div>
  ),
}));

import CapturePage from "@/app/(app)/capture/page";

function sheet(name: string) {
  return new File(["a,b\n1,2"], name, { type: "text/csv" });
}

describe("spreadsheet queue", () => {
  it("maps each dropped sheet in turn, dropping none", async () => {
    render(<CapturePage />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [sheet("a.csv"), sheet("b.csv"), sheet("c.csv")],
    });
    fireEvent.change(input);

    expect(await screen.findByText("mapping:a.csv")).toBeTruthy();
    fireEvent.click(screen.getByText("finish-sheet"));
    expect(await screen.findByText("mapping:b.csv")).toBeTruthy();
    fireEvent.click(screen.getByText("finish-sheet"));
    expect(await screen.findByText("mapping:c.csv")).toBeTruthy();
  });
});
```

> Note: if `CapturePage` needs a QueryClient/providers wrapper to render, reuse the existing render helper from `web/components/dashboard/analyst/analyst-pane.test.tsx` (look for its `renderWithClient`/provider wrapper) and wrap `<CapturePage />` the same way.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run "app/(app)/capture/__tests__/spreadsheet-queue.test.tsx"`
Expected: FAIL — only `a.csv` maps; `b.csv` never appears (current `sheets[0]` behavior), or `onDone` is not a prop yet.

- [ ] **Step 3: Add `onDone` to `CsvWizard`**

In `web/components/capture/csv-wizard.tsx`, change the signature:

```tsx
export function CsvWizard({ initialFile, onDone }: { initialFile?: File; onDone?: () => void } = {}) {
```

Then find the success path (where a mapping is saved / the wizard completes) and call `onDone?.()` there. Also expose it on the dismiss/skip control if one exists. If the wizard has a final "Save mapping" handler, append `onDone?.();` after the save succeeds.

> If `CsvWizard` has no single completion point, add an explicit `onDone` call to its primary submit success handler and to any "Skip"/"Done" button. The contract: `onDone` fires exactly once when the user is finished with this sheet.

- [ ] **Step 4: Convert `spreadsheet` to a queue in `page.tsx`**

Replace the state and `ingest` sheet handling:

```tsx
  const [sheets, setSheets] = useState<File[]>([]);
```

In `ingest`, replace `if (sheets.length > 0) setSpreadsheet(sheets[0]);` with:

```tsx
    const sheetFiles = files.filter((f) => classifyFile(f) === "spreadsheet");
    const docs = files.filter((f) => classifyFile(f) === "doc");
    if (sheetFiles.length > 0) setSheets((q) => [...q, ...sheetFiles]);
```

(Remove the now-shadowed `const sheets = ...` / `const docs = ...` lines that used the old names; keep `docs`.)

Replace the spreadsheet panel block:

```tsx
      {sheets.length > 0 && (
        <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-bold tracking-tight">
              Map &ldquo;{sheets[0].name}&rdquo;
              {sheets.length > 1 && (
                <span className="ml-2 text-xs font-normal text-muted">
                  (1 of {sheets.length})
                </span>
              )}
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setSheets((q) => q.slice(1))}>
              Skip
            </Button>
          </div>
          <CsvWizard
            key={sheets[0].name}
            initialFile={sheets[0]}
            onDone={() => setSheets((q) => q.slice(1))}
          />
        </div>
      )}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run "app/(app)/capture/__tests__/spreadsheet-queue.test.tsx"`
Expected: PASS

- [ ] **Step 6: Verify full frontend typecheck + capture tests**

Run: `cd web && npx tsc --noEmit && npx vitest run app/\(app\)/capture components/capture`
Expected: no type errors; tests pass.

- [ ] **Step 7: Commit**

```bash
git add "web/app/(app)/capture/page.tsx" web/components/capture/csv-wizard.tsx "web/app/(app)/capture/__tests__/spreadsheet-queue.test.tsx"
git commit -m "feat(web): queue multiple spreadsheets, map one at a time"
```

---

## Task 10: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Backend suite**

Run: `cd backend && python -m pytest tests/test_ocr_grouping.py tests/test_m4_documents.py tests/test_m5_ocr.py -v`
Expected: PASS (DB-dependent `resolve_group`/`m5` tests may SKIP if no Postgres — that is acceptable; the grouping + m4 unit tests must PASS).

- [ ] **Step 2: Frontend typecheck + unit tests**

Run: `cd web && npx tsc --noEmit && npm run test:unit`
Expected: typecheck clean; all vitest tests pass.

- [ ] **Step 3: Manual smoke (optional, requires running stack)**

Upload two images of one receipt (merchant on one, total on the other) in a single selection → a "Looks like one receipt — from 2 images" group appears with a merged total; Confirm creates one transaction. Drop two CSVs → both map in sequence, neither is dropped.

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "test: full-suite verification for receipt grouping + batch ingest"
```

---

## Self-Review Notes

- **Spec coverage:** batch tagging (T3, T7), read-time grouping pure fns (T1, T2), grouped response (T4), group confirm/split (T5, T8), spreadsheet queue (T9), error/edge cases (stale member → T5 test; conflicting totals → T2 test; missing batch_id → T2 test; group-of-1 demotion → T2 cluster logic). All spec sections map to tasks.
- **No DB/migration changes** — confirmed; all state in `ocr_meta`.
- **Type consistency:** `merge_extractions -> (data, summary)` used identically in T2, T4, T5. `ReviewGroup.member_ids` (backend) vs response `member_document_ids` (T4 maps one to the other). Frontend `useResolveGroup({memberDocumentIds, action, data})` matches `ResolveGroupIn` field `member_document_ids` via the POST body. `SuggestedGroupCard` props match T8 test and `ReviewQueueInline` usage.
