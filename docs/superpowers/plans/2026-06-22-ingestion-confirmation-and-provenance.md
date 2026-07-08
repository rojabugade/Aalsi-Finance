# Ingestion Confirmation Gate + Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every auto-detected upload pass through an explicit user confirmation before it becomes a transaction, give the user a history view showing where each ingested item went, and turn the Email and Splitwise dead-ends into real ingestion.

**Architecture:** The OCR pipeline stops auto-committing; all extracted documents land at `needs_review` and only become transactions when the user confirms (the one existing handoff path). The frontend review surface gains editable fields; a new "Recent activity" list on `/capture` shows every document with a provenance link to its transaction. Email attachments are routed through the real document pipeline so they ride the same gate; Splitwise balances are exposed read-only.

**Tech Stack:** FastAPI + SQLAlchemy async (backend), pytest (backend tests), Next.js App Router + TanStack Query + openapi-fetch (frontend), vitest (frontend tests). Frontend talks to the backend through generated types in `shared/api-schema.ts` (regenerated with `npm run gen:api`).

## Global Constraints

- Backend tests follow the existing pattern in `backend/tests/test_m*.py` and run against the `finance_test` Postgres DB. Run with `cd backend && pytest tests/<file> -v` (inside the api container if the local venv is broken — see project memory `verifying-tests-via-docker`).
- Frontend tests run with `cd web && npx vitest run <file>`.
- After ANY backend route/schema change, regenerate shared types: API running on `:8000`, then `cd web && npm run gen:api`. New types appear under `components["schemas"][...]` in `shared/api-schema.ts`.
- Money stays as strings/Decimal across the wire; never use floats for amounts.
- Plaid and SMS ingestion MUST NOT change — they stay auto-commit.
- Commit after each task with a `feat:`/`fix:`/`test:` message ending with the repo's required Co-Authored-By / Claude-Session trailers.

---

### Task 1: Spine — uploads never auto-commit; confirm is the only commit path

The pipeline currently auto-creates a draft transaction when confidence is high. Change it so every successfully extracted document ends at `needs_review` and creates no transaction; the existing `resolve_review(confirm)` remains the only path that creates transactions. Also expose the extracted `data` on the review item so the UI can show editable fields.

**Files:**
- Modify: `backend/app/ocr/service.py` (`process_document` tail; ~lines 293–314)
- Modify: `backend/app/ocr/schemas.py` (`ReviewItemOut`, ~line 104)
- Modify: `backend/app/ocr/router.py` (`_to_review_out`, ~line 21)
- Test: `backend/tests/test_m5_ocr.py`

**Interfaces:**
- Produces: `ReviewItemOut` now carries `data: dict | None`. Document status after a successful pipeline run is always `"needs_review"`.

- [ ] **Step 1: Update the failing test for no-auto-commit**

In `backend/tests/test_m5_ocr.py`, find the test(s) asserting a high-confidence document becomes `processed` and/or auto-creates a transaction. Change the expectation. Add this test (adapt fixture names to the file's existing helpers for building a high-confidence receipt document and running the pipeline):

```python
@pytest.mark.asyncio
async def test_high_confidence_receipt_waits_for_confirmation(session, store, fake_llm, receipt_document):
    # fake_llm returns a confident receipt extraction
    doc = await ocr_service.process_document(session, store, fake_llm, receipt_document.id)
    assert doc.status == "needs_review"
    # No transaction is created by the pipeline itself.
    from app.models.transactions import Transaction
    from sqlalchemy import select
    txns = (await session.execute(
        select(Transaction).where(Transaction.source_document_id == receipt_document.id)
    )).scalars().all()
    assert txns == []
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && pytest tests/test_m5_ocr.py::test_high_confidence_receipt_waits_for_confirmation -v`
Expected: FAIL — currently the document becomes `processed` and a transaction exists.

- [ ] **Step 3: Make the pipeline always route to needs_review**

In `backend/app/ocr/service.py`, replace the tail of `process_document` (the block from `_write_ocr_meta(document, result)` through the final `await session.commit()` and `log.info(...)`) with:

```python
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
```

Leave `_handoff_to_m6` and `resolve_review` unchanged — `resolve_review(confirm)` still calls the handoff.

- [ ] **Step 4: Expose extracted data on the review item**

In `backend/app/ocr/schemas.py`, add a field to `ReviewItemOut`:

```python
class ReviewItemOut(BaseModel):
    document_id: str
    type: str
    status: str
    confidence: float | None = None
    summary: dict | None = None
    data: dict | None = None
    reasons: list[str] = Field(default_factory=list)
```

In `backend/app/ocr/router.py`, update `_to_review_out` to populate it:

```python
def _to_review_out(document: Document) -> ReviewItemOut:
    ocr = (document.ocr_meta or {}).get("ocr", {})
    return ReviewItemOut(
        document_id=str(document.id),
        type=document.type,
        status=document.status,
        confidence=ocr.get("confidence"),
        summary=ocr.get("summary"),
        data=ocr.get("data"),
        reasons=ocr.get("reasons", []),
    )
```

- [ ] **Step 5: Add the confirm-creates-transaction test**

In `backend/tests/test_m5_ocr.py` add (adapt to existing helpers):

```python
@pytest.mark.asyncio
async def test_confirm_creates_transaction_with_provenance(session, store, fake_llm, receipt_document):
    await ocr_service.process_document(session, store, fake_llm, receipt_document.id)
    user = await session.get(User, receipt_document.uploaded_by_user_id)
    doc = await ocr_service.resolve_review(
        session, user, receipt_document.id, ResolveIn(action="confirm")
    )
    assert doc.status == "processed"
    from app.models.transactions import Transaction
    from sqlalchemy import select
    txns = (await session.execute(
        select(Transaction).where(Transaction.source_document_id == receipt_document.id)
    )).scalars().all()
    assert len(txns) >= 1
```

Add imports at the top of the test if missing: `from app.models.core import User` and `from app.ocr.schemas import ResolveIn`.

- [ ] **Step 6: Run the OCR tests**

Run: `cd backend && pytest tests/test_m5_ocr.py -v`
Expected: PASS (including any pre-existing tests you adjusted in Step 1).

- [ ] **Step 7: Commit**

```bash
git add backend/app/ocr/service.py backend/app/ocr/schemas.py backend/app/ocr/router.py backend/tests/test_m5_ocr.py
git commit -m "feat(ocr): hold all auto-detected uploads for confirmation; expose extracted data"
```

---

### Task 2: Provenance API — link documents to the transactions they produced

`GET /documents` lists documents but never says what each became. Add a transaction summary array to `DocumentOut` and add the missing `splitwise` source channel.

**Files:**
- Modify: `backend/app/documents/schemas.py`
- Modify: `backend/app/documents/service.py`
- Modify: `backend/app/documents/router.py`
- Test: `backend/tests/test_m4_documents.py`

**Interfaces:**
- Produces: `DocumentOut.transactions: list[TransactionRef]` where `TransactionRef = {id, merchant, amount, currency, status}`. New service fn `transactions_for_documents(session, document_ids) -> dict[UUID, list[dict]]`.

- [ ] **Step 1: Write the failing test**

In `backend/tests/test_m4_documents.py` add (adapt fixtures to the file's auth/client helpers):

```python
@pytest.mark.asyncio
async def test_documents_list_includes_provenance(client, auth_headers, session, sample_document, sample_merchant):
    from app.models.transactions import Transaction
    txn = Transaction(
        household_id=sample_document.household_id,
        merchant_id=sample_merchant.id,
        amount="42.10", currency="USD", txn_date="2026-06-01",
        status="draft", source_document_id=sample_document.id, source_channel="upload",
    )
    session.add(txn)
    await session.commit()

    resp = await client.get("/documents", headers=auth_headers)
    assert resp.status_code == 200
    row = next(d for d in resp.json() if d["id"] == str(sample_document.id))
    assert len(row["transactions"]) == 1
    assert row["transactions"][0]["merchant"] == sample_merchant.name
    assert row["transactions"][0]["amount"] == "42.10"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && pytest tests/test_m4_documents.py::test_documents_list_includes_provenance -v`
Expected: FAIL — `transactions` key missing (KeyError).

- [ ] **Step 3: Add the schema**

In `backend/app/documents/schemas.py`: add `from decimal import Decimal` to imports, extend the channel literal, and add the ref model + field:

```python
SourceChannel = Literal["upload", "email", "sms", "bot", "plaid", "manual", "splitwise"]


class TransactionRef(BaseModel):
    id: uuid.UUID
    merchant: str | None = None
    amount: Decimal
    currency: str
    status: str
```

Add to `DocumentOut` (after `summary`):

```python
    transactions: list[TransactionRef] = Field(default_factory=list)
```

- [ ] **Step 4: Add the batch query in service**

In `backend/app/documents/service.py` add (the file already imports `select` and `uuid`; add the model import near the top):

```python
from app.models.transactions import Merchant, Transaction


async def transactions_for_documents(
    session: AsyncSession, document_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[dict]]:
    """Map each document id to summaries of the transactions it produced."""
    if not document_ids:
        return {}
    stmt = (
        select(Transaction, Merchant.name)
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
```

- [ ] **Step 5: Populate transactions in the router**

In `backend/app/documents/router.py` change `_to_out` to accept refs, and populate them in the list and detail endpoints:

```python
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
```

In `list_documents`:

```python
    docs = await service.list_documents(session, user, status=status_filter, doc_type=type)
    refs = await service.transactions_for_documents(session, [d.id for d in docs])
    return [_to_out(d, refs.get(d.id)) for d in docs]
```

In `get_document`:

```python
    document = await service.get_document(session, user, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    refs = await service.transactions_for_documents(session, [document.id])
    return _to_out(document, refs.get(document.id))
```

(The `upload_document` return stays `_to_out(document)` — a fresh upload has no transactions yet.)

- [ ] **Step 6: Run the tests**

Run: `cd backend && pytest tests/test_m4_documents.py -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/documents/schemas.py backend/app/documents/service.py backend/app/documents/router.py backend/tests/test_m4_documents.py
git commit -m "feat(documents): expose document->transaction provenance and splitwise channel"
```

---

### Task 3: Email attachments ride the real ingestion pipeline

`email_sync` creates `Document` rows but never stores attachment bytes or enqueues OCR. Route each attachment through `documents.service.create_document` so it lands at `uploaded` and enqueues OCR — then it rides the confirmation gate like any upload.

**Files:**
- Modify: `backend/app/ingestion/service.py` (`email_sync`, add `_ingest_email_attachments`)
- Modify: `backend/app/ingestion/schemas.py` (`EmailSyncOut`)
- Test: `backend/tests/test_m11_ingestion.py`

**Interfaces:**
- Consumes: `documents.service.create_document(...)`, `documents.service.enqueue_ocr(...)`, `documents.processing.UnsupportedFile`.
- Produces: `EmailSyncOut` gains `attachments_ingested: int`; `email_sync` returns `{"documents_created", "attachments_ingested"}`.

- [ ] **Step 1: Write the failing test**

In `backend/tests/test_m11_ingestion.py` add (use the file's existing user/session fixtures; the fake gateway returns one message with one PNG attachment):

```python
@pytest.mark.asyncio
async def test_email_sync_ingests_attachment_as_document(session, user, monkeypatch):
    import base64
    png = bytes.fromhex("89504e470d0a1a0a") + b"\x00" * 16  # PNG magic + filler
    b64 = base64.urlsafe_b64encode(png).decode().rstrip("=")

    class FakeGmail:
        async def fetch_messages(self, token):
            return [{
                "from_address": "bank@example.com", "subject": "Receipt", "body": "hi",
                "attachments": [{"filename": "r.png", "mime_type": "image/png", "data_base64url": b64}],
            }]

    # connect an active email connection for `user` first (reuse the file's helper if present)
    await _connect_email(session, user)  # adapt: insert IngestionConnection(channel="email", status="active")

    enqueued = []
    monkeypatch.setattr("app.documents.service.enqueue_ocr", lambda doc_id: enqueued.append(doc_id))

    result = await service.email_sync(session, user, FakeGmail())
    assert result["attachments_ingested"] == 1
    assert len(enqueued) == 1

    from app.models.documents import Document
    from sqlalchemy import select
    docs = (await session.execute(
        select(Document).where(Document.source_channel == "email", Document.type != "other")
    )).scalars().all()
    assert any(d.status == "uploaded" for d in docs)
```

If the test file has no email-connection helper, inline one that adds an `IngestionConnection(user_id=user.id, channel="email", provider="gmail", token_encrypted=encrypt_string("t"), status="active")` and commits.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && pytest tests/test_m11_ingestion.py::test_email_sync_ingests_attachment_as_document -v`
Expected: FAIL — `KeyError: 'attachments_ingested'`.

- [ ] **Step 3: Add the attachment-ingestion helper**

In `backend/app/ingestion/service.py` add imports near the top:

```python
import base64

from app.documents import service as doc_service
from app.documents.processing import UnsupportedFile
from app.documents.storage import get_object_store
```

Add the helper:

```python
async def _ingest_email_attachments(session: AsyncSession, user: User, attachments: list[dict]) -> int:
    """Route each email attachment through the real document pipeline + OCR enqueue."""
    store = get_object_store()
    count = 0
    for att in attachments or []:
        raw_b64 = att.get("data_base64url")
        if not raw_b64:
            continue
        data = base64.urlsafe_b64decode(raw_b64 + "=" * (-len(raw_b64) % 4))
        try:
            doc = await doc_service.create_document(
                session, store,
                household_id=user.household_id,
                uploaded_by_user_id=user.id,
                file_bytes=data,
                filename=att.get("filename") or "attachment",
                content_type=att.get("mime_type"),
                channel="email",
            )
        except UnsupportedFile:
            continue  # skip unreadable attachments; do not fail the whole sync
        await session.commit()
        await session.refresh(doc)
        doc_service.enqueue_ocr(doc.id)
        count += 1
    return count
```

- [ ] **Step 4: Wire it into email_sync**

Replace the body of `email_sync` with:

```python
async def email_sync(session: AsyncSession, user: User, gateway: GmailGateway) -> dict:
    conn = (await session.execute(select(IngestionConnection).where(
        IngestionConnection.user_id == user.id,
        IngestionConnection.channel == "email",
        IngestionConnection.status == "active",
    ))).scalars().first()
    if conn is None:
        raise NotFound("Email connection not found")
    token = decrypt_string(conn.token_encrypted) or ""
    messages = await gateway.fetch_messages(token)
    docs = 0
    attachments_ingested = 0
    for msg in messages:
        payload = EmailInboundIn(**msg)
        await create_email_document(session, user, payload)
        docs += 1
        attachments_ingested += await _ingest_email_attachments(session, user, payload.attachments)
    return {"documents_created": docs, "attachments_ingested": attachments_ingested}
```

(`create_email_document` already commits, so the trailing `await session.commit()` is removed.)

- [ ] **Step 5: Extend the response schema**

In `backend/app/ingestion/schemas.py`:

```python
class EmailSyncOut(BaseModel):
    documents_created: int
    attachments_ingested: int = 0
```

- [ ] **Step 6: Run the tests**

Run: `cd backend && pytest tests/test_m11_ingestion.py -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/ingestion/service.py backend/app/ingestion/schemas.py backend/tests/test_m11_ingestion.py
git commit -m "feat(ingestion): ingest email attachments through the document pipeline"
```

---

### Task 4: Splitwise balances read-only endpoint

Expose the latest synced Splitwise balances so the frontend can show a read-only card. Source of truth is the most recent `splitwise` document's `ocr_meta`.

**Files:**
- Modify: `backend/app/ingestion/service.py` (add `splitwise_balances`)
- Modify: `backend/app/ingestion/schemas.py` (add `SplitwiseBalancesOut`)
- Modify: `backend/app/ingestion/router.py` (add `GET /splitwise/balances`)
- Test: `backend/tests/test_splitwise_service.py`

**Interfaces:**
- Produces: `GET /ingestion/splitwise/balances` → `{balances: list[dict], synced_at: datetime | None}`.

- [ ] **Step 1: Write the failing test**

In `backend/tests/test_splitwise_service.py` add:

```python
@pytest.mark.asyncio
async def test_splitwise_balances_returns_latest(session, user):
    from app.models.documents import Document
    doc = Document(
        household_id=user.household_id, uploaded_by_user_id=user.id,
        storage_key="splitwise://x", type="other", source_channel="splitwise",
        status="processed",
        ocr_meta={"splitwise": {"events": [{"friend": "Sam", "amount": "12.50", "currency": "USD"}]}},
    )
    session.add(doc)
    await session.commit()

    result = await service.splitwise_balances(session, user)
    assert result["balances"] == [{"friend": "Sam", "amount": "12.50", "currency": "USD"}]
    assert result["synced_at"] is not None
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && pytest tests/test_splitwise_service.py::test_splitwise_balances_returns_latest -v`
Expected: FAIL — `AttributeError: module ... has no attribute 'splitwise_balances'`.

- [ ] **Step 3: Implement the service function**

In `backend/app/ingestion/service.py` add:

```python
async def splitwise_balances(session: AsyncSession, user: User) -> dict:
    stmt = (
        select(Document)
        .where(Document.household_id == user.household_id, Document.source_channel == "splitwise")
        .order_by(Document.created_at.desc())
        .limit(1)
    )
    doc = (await session.execute(stmt)).scalars().first()
    if doc is None:
        return {"balances": [], "synced_at": None}
    events = (doc.ocr_meta or {}).get("splitwise", {}).get("events", [])
    return {"balances": events, "synced_at": doc.created_at}
```

- [ ] **Step 4: Add the schema**

In `backend/app/ingestion/schemas.py`:

```python
class SplitwiseBalancesOut(BaseModel):
    balances: list[dict]
    synced_at: datetime | None = None
```

(`datetime` is already imported in this module — confirm; if not, add `from datetime import datetime`.)

- [ ] **Step 5: Add the route**

In `backend/app/ingestion/router.py`, import `SplitwiseBalancesOut` alongside the other splitwise schemas, then add near the other splitwise routes:

```python
@router.get("/splitwise/balances", response_model=SplitwiseBalancesOut)
async def splitwise_balances(
    user: User = Depends(require_role("owner", "member")),
    session: AsyncSession = Depends(get_session),
):
    return await service.splitwise_balances(session, user)
```

- [ ] **Step 6: Run the tests**

Run: `cd backend && pytest tests/test_splitwise_service.py -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/ingestion/service.py backend/app/ingestion/schemas.py backend/app/ingestion/router.py backend/tests/test_splitwise_service.py
git commit -m "feat(ingestion): read-only splitwise balances endpoint"
```

---

### Task 5: Frontend — regenerate types + editable confirmation card

Regenerate the shared types (now that all backend endpoints exist), then build a confirmation card that shows the detected type and editable extracted fields, and wire it into `/review` and the inline review block on `/capture`.

**Files:**
- Modify: `web/shared/api-schema.ts` (regenerated, do not hand-edit) — note: actual path is `shared/api-schema.ts` referenced via `@shared`
- Create: `web/components/capture/confirm-card.tsx`
- Create: `web/components/capture/confirm-card.test.tsx`
- Modify: `web/app/(app)/review/page.tsx`
- Modify: `web/app/(app)/capture/page.tsx` (`ReviewQueueInline`)

**Interfaces:**
- Consumes: `useResolveReview()` from `lib/api/review.ts` (mutation accepts `{documentId, action, data?}`); `ReviewItem` type now includes `data`.
- Produces: `<ConfirmCard item={ReviewItem} onResolve={(action, data?) => Promise<void>} pending={boolean} />`.

- [ ] **Step 1: Regenerate shared types**

Start the API (`:8000`), then:

Run: `cd web && npm run gen:api`
Expected: `shared/api-schema.ts` updated; `git diff --stat shared/api-schema.ts` shows changes (new `SplitwiseBalancesOut`, `TransactionRef`, `attachments_ingested`, `data` on `ReviewItemOut`).

- [ ] **Step 2: Write the failing component test**

Create `web/components/capture/confirm-card.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConfirmCard } from "./confirm-card";

const item = {
  document_id: "doc-1", type: "receipt", status: "needs_review",
  confidence: 0.95, summary: { merchant: "Trader Joe's", total: "42.10" },
  data: { merchant: "Trader Joe's", total: "42.10", currency: "USD", date: "2026-06-01", line_items: [] },
  reasons: [],
};

describe("ConfirmCard", () => {
  it("confirms with edited total", () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(<ConfirmCard item={item as never} onResolve={onResolve} pending={false} />);
    fireEvent.click(screen.getByRole("button", { name: /fix/i }));
    fireEvent.change(screen.getByLabelText(/total/i), { target: { value: "43.00" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onResolve).toHaveBeenCalledWith("confirm", expect.objectContaining({ total: "43.00" }));
  });

  it("rejects", () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(<ConfirmCard item={item as never} onResolve={onResolve} pending={false} />);
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(onResolve).toHaveBeenCalledWith("reject");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd web && npx vitest run components/capture/confirm-card.test.tsx`
Expected: FAIL — module `./confirm-card` not found.

- [ ] **Step 4: Implement the ConfirmCard**

Create `web/components/capture/confirm-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { CheckCircle2, Pencil, XCircle } from "lucide-react";
import type { ReviewItem, ResolveAction } from "@/lib/api/review";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Data = Record<string, unknown>;

export function ConfirmCard({
  item,
  onResolve,
  pending,
}: {
  item: ReviewItem;
  onResolve: (action: ResolveAction, data?: Data) => Promise<void>;
  pending: boolean;
}) {
  const initial = (item.data ?? {}) as Data;
  const [editing, setEditing] = useState(false);
  const [merchant, setMerchant] = useState(String(initial.merchant ?? ""));
  const [total, setTotal] = useState(String(initial.total ?? ""));

  const isReceipt = item.type === "receipt" || item.type === "invoice";
  const high = (item.confidence ?? 0) >= 0.8;

  async function confirm() {
    const data = editing ? { ...initial, merchant, total } : undefined;
    await onResolve("confirm", data);
  }

  return (
    <li className="rounded-lg border border-border px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium capitalize">{item.type}</p>
          <p className="text-xs text-muted">
            {isReceipt ? `${merchant || "Unknown"} · ${total || "?"}` : item.summary
              ? JSON.stringify(item.summary)
              : "Needs a look"}
          </p>
        </div>
        <Badge variant={high ? "success" : "warning"}>
          {item.confidence != null ? `${Math.round(item.confidence * 100)}%` : "check"}
        </Badge>
      </div>

      {editing && isReceipt && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-xs">
            Merchant
            <input
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
            />
          </label>
          <label className="text-xs">
            Total
            <input
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
            />
          </label>
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <Button size="sm" disabled={pending} onClick={confirm}>
          <CheckCircle2 className="size-4" /> Confirm
        </Button>
        {isReceipt && (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => setEditing((v) => !v)}>
            <Pencil className="size-4" /> Fix
          </Button>
        )}
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => onResolve("reject")}>
          <XCircle className="size-4" /> Reject
        </Button>
      </div>
    </li>
  );
}
```

- [ ] **Step 5: Run the component test**

Run: `cd web && npx vitest run components/capture/confirm-card.test.tsx`
Expected: PASS.

- [ ] **Step 6: Wire ConfirmCard into the capture inline queue**

In `web/app/(app)/capture/page.tsx`, replace the `<li>` body inside `ReviewQueueInline`'s `items.map(...)` with `<ConfirmCard>`:

```tsx
import { ConfirmCard } from "@/components/capture/confirm-card";
// ...
{items.map((item) => (
  <ConfirmCard
    key={item.document_id}
    item={item}
    pending={resolve.isPending}
    onResolve={(action, data) => act(item.document_id, action, data)}
  />
))}
```

Update the `act` helper signature in `ReviewQueueInline`:

```tsx
async function act(documentId: string, action: "confirm" | "reject", data?: Record<string, unknown>) {
  try {
    await resolve.mutateAsync({ documentId, action, data });
    toast.success(action === "confirm" ? "Confirmed" : "Rejected");
  } catch {
    toast.error("Couldn't update that item");
  }
}
```

- [ ] **Step 7: Wire ConfirmCard into the /review page**

In `web/app/(app)/review/page.tsx`, render each queue item with `<ConfirmCard>` using the same `useResolveReview()` mutation (replace the existing per-item row markup; keep the page's loading/error/empty states). Import `ConfirmCard` and pass `onResolve={(action, data) => resolve.mutateAsync({ documentId: item.document_id, action, data }).then(() => {})}`.

- [ ] **Step 8: Typecheck + tests**

Run: `cd web && npx tsc --noEmit && npx vitest run components/capture/confirm-card.test.tsx`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add shared/api-schema.ts web/components/capture/confirm-card.tsx web/components/capture/confirm-card.test.tsx "web/app/(app)/review/page.tsx" "web/app/(app)/capture/page.tsx"
git commit -m "feat(web): editable confirmation card for auto-detected uploads"
```

---

### Task 6: Frontend — upload history + provenance section on /capture

Add a `useDocuments()` hook and a "Recent activity" list showing every ingested document and the transaction it became.

**Files:**
- Create: `web/lib/api/documents.ts`
- Create: `web/lib/api/documents.test.ts`
- Modify: `web/app/(app)/capture/page.tsx`

**Interfaces:**
- Consumes: `GET /documents` → `DocumentOut[]` with `transactions: TransactionRef[]`.
- Produces: `useDocuments()` query hook; `<RecentActivity />` section rendered on `/capture`.

- [ ] **Step 1: Write the failing hook test**

Create `web/lib/api/documents.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { provenanceLabel } from "./documents";

describe("provenanceLabel", () => {
  it("summarizes a produced transaction", () => {
    expect(
      provenanceLabel([{ id: "t1", merchant: "Trader Joe's", amount: "42.10", currency: "USD", status: "draft" }]),
    ).toBe("→ $42.10 at Trader Joe's");
  });
  it("returns a dash when nothing was produced", () => {
    expect(provenanceLabel([])).toBe("—");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run lib/api/documents.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook + helper**

Create `web/lib/api/documents.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import type { components } from "@shared/api-schema";
import { api } from "./client";

export type DocumentRow = components["schemas"]["DocumentOut"];
export type TransactionRef = components["schemas"]["TransactionRef"];

async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error || data === undefined) throw error ?? new Error("Request failed");
  return data;
}

export function useDocuments() {
  return useQuery<DocumentRow[]>({
    queryKey: ["documents"],
    queryFn: () => unwrap(api.GET("/documents", {})),
  });
}

export function provenanceLabel(txns: TransactionRef[] | undefined): string {
  if (!txns || txns.length === 0) return "—";
  const t = txns[0];
  const at = t.merchant ? ` at ${t.merchant}` : "";
  const more = txns.length > 1 ? ` (+${txns.length - 1} more)` : "";
  return `→ $${t.amount}${at}${more}`;
}
```

- [ ] **Step 4: Run the test**

Run: `cd web && npx vitest run lib/api/documents.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the RecentActivity section to /capture**

In `web/app/(app)/capture/page.tsx`, add a `RecentActivity` component and render it after `<ReviewQueueInline />`:

```tsx
import { useDocuments, provenanceLabel } from "@/lib/api/documents";

function statusLabel(s: string) {
  if (s === "needs_review") return "Pending confirm";
  if (s === "processed") return "Confirmed";
  if (s === "failed") return "Failed";
  if (s === "processing") return "Processing";
  return "Received";
}

function RecentActivity() {
  const docs = useDocuments();
  const items = docs.data ?? [];
  return (
    <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="mb-3">
        <h2 className="text-base font-bold tracking-tight">Recent activity</h2>
        <p className="text-sm text-muted">Everything you&rsquo;ve added and where it went.</p>
      </div>
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Nothing yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {d.original_filename || `${d.source_channel} ${d.type}`}
                </p>
                <p className="text-xs text-muted">
                  <span className="capitalize">{d.source_channel}</span> · {d.type} · {statusLabel(d.status)}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted">{provenanceLabel(d.transactions)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Render it in the page body, after `<ReviewQueueInline />`:

```tsx
      <ReviewQueueInline />
      <RecentActivity />
```

- [ ] **Step 6: Typecheck + tests**

Run: `cd web && npx tsc --noEmit && npx vitest run lib/api/documents.test.ts`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add web/lib/api/documents.ts web/lib/api/documents.test.ts "web/app/(app)/capture/page.tsx"
git commit -m "feat(web): recent activity + provenance on capture"
```

---

### Task 7: Frontend — Splitwise balances card on /connections

Add a `useSplitwiseBalances()` hook and a read-only balances card.

**Files:**
- Modify: `web/lib/api/connections.ts` (add hook + type)
- Create: `web/lib/api/connections.splitwise-balances.test.ts`
- Modify: `web/app/(app)/connections/page.tsx`

**Interfaces:**
- Consumes: `GET /splitwise/balances` → `SplitwiseBalancesOut`.
- Produces: `useSplitwiseBalances()` query hook; `netBalance(balances)` helper.

- [ ] **Step 1: Write the failing helper test**

Create `web/lib/api/connections.splitwise-balances.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { netBalance } from "./connections";

describe("netBalance", () => {
  it("sums signed friend balances", () => {
    expect(netBalance([{ friend: "A", amount: "10.00", currency: "USD" }, { friend: "B", amount: "-4.00", currency: "USD" }])).toBe(6);
  });
  it("handles empty", () => {
    expect(netBalance([])).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run lib/api/connections.splitwise-balances.test.ts`
Expected: FAIL — `netBalance` not exported.

- [ ] **Step 3: Implement the hook + helper**

In `web/lib/api/connections.ts` add:

```ts
export type SplitwiseBalances = components["schemas"]["SplitwiseBalancesOut"];

export function useSplitwiseBalances() {
  return useQuery<SplitwiseBalances>({
    queryKey: ["splitwise-balances"],
    queryFn: () => unwrap(api.GET("/splitwise/balances", {})),
  });
}

export function netBalance(balances: { amount: string }[]): number {
  return balances.reduce((sum, b) => sum + Number(b.amount), 0);
}
```

(Reuse the file's existing `unwrap` and `api` imports — do not redeclare them.)

- [ ] **Step 4: Run the test**

Run: `cd web && npx vitest run lib/api/connections.splitwise-balances.test.ts`
Expected: PASS.

- [ ] **Step 5: Render the card on /connections**

In `web/app/(app)/connections/page.tsx`, inside the existing Splitwise connection area, render balances when connected (use the page's existing card/styling primitives). Minimal version:

```tsx
import { useSplitwiseBalances, netBalance } from "@/lib/api/connections";
// ...
function SplitwiseBalancesCard() {
  const q = useSplitwiseBalances();
  const balances = q.data?.balances ?? [];
  if (balances.length === 0) return null;
  const net = netBalance(balances as { amount: string }[]);
  return (
    <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold">Splitwise balances</h3>
        <span className={net >= 0 ? "text-sm font-semibold text-success" : "text-sm font-semibold text-destructive"}>
          net {net >= 0 ? "+" : ""}{net.toFixed(2)}
        </span>
      </div>
      <ul className="space-y-1">
        {balances.map((b, i) => (
          <li key={i} className="flex justify-between text-sm">
            <span>{(b as { friend?: string }).friend ?? "Friend"}</span>
            <span className="text-muted">{(b as { amount: string }).amount} {(b as { currency?: string }).currency ?? ""}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">Read-only. Splitwise balances aren&rsquo;t added as transactions.</p>
    </div>
  );
}
```

Render `<SplitwiseBalancesCard />` near the Splitwise card. After a `useSplitwiseSync()` succeeds, invalidate `["splitwise-balances"]` so the card refreshes (add `qc.invalidateQueries({ queryKey: ["splitwise-balances"] })` to the sync mutation's `onSuccess`, or refetch on the page).

- [ ] **Step 6: Typecheck + tests**

Run: `cd web && npx tsc --noEmit && npx vitest run lib/api/connections.splitwise-balances.test.ts`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add web/lib/api/connections.ts web/lib/api/connections.splitwise-balances.test.ts "web/app/(app)/connections/page.tsx"
git commit -m "feat(web): read-only splitwise balances card"
```

---

## Self-Review Notes

**Spec coverage:**
- Spine (always-confirm) → Task 1.
- Pillar 1 (confirmation UI) → Task 5.
- Pillar 2 (history + provenance) → Tasks 2 (API) + 6 (UI).
- Pillar 3 (email ingests) → Task 3.
- Pillar 4 (splitwise balances) → Tasks 4 (API) + 7 (UI).
- Reject = mark failed, keep in history → already in `resolve_review`; surfaced via Task 6 history (`Failed` status) and Task 5 reject action.
- History location = section on `/capture` → Task 6.

**Known integration checks for the executor:**
- Confirm a Celery worker is running (or eager mode) when manually verifying the end-to-end receipt flow — `enqueue_ocr` is a no-op-safe `.delay()`; without a worker, documents stay `uploaded` and never reach `needs_review`. Note this in UAT, not a code change.
- When adapting test fixtures, match the helpers already present in each target test file (auth client, session, user, merchant). The test bodies above specify the assertions; wire them to existing fixtures.
