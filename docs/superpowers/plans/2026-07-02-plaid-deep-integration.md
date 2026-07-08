# Plaid Deep Integration + Spend UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Plaid a first-class citizen — auto-registered loan/CC payments, linked refunds, live balances, filtered Link picker — plus Gmail body parsing and a unified categories-first spend view.

**Architecture:** Backend enrichment runs inside `plaid_sync` per item (new `plaid_matching` module), never failing the sync. Frontend derives spend client-side in `web/lib/spend/derive.ts`; flag-aware changes there propagate to every spend surface. Spec: `docs/superpowers/specs/2026-07-02-plaid-deep-integration-design.md`.

**Tech Stack:** FastAPI + SQLAlchemy async + Postgres (5433), plaid-python 29.1.0, Next.js app router, TanStack Query, vitest, pytest.

## Global Constraints

- **Sign convention (canonical):** money OUT is stored NEGATIVE, money IN positive (`web/lib/spend/derive.ts:12`). Plaid reports outflow positive — negate at ingest.
- All ingested transactions land as `status="draft"` (existing confirmation gate).
- Enrichment (payments/refunds/balances) must NEVER fail a sync — catch, log, continue.
- Idempotent across re-syncs: keyed on Plaid `transaction_id` / Gmail message id.
- Backend tests: `cd backend && python -m pytest tests/test_m11_ingestion.py -v` (needs Postgres at `postgresql+asyncpg://finance:finance@localhost:5433/finance`; tests skip if absent; local .venv broken → run inside api container: `docker compose exec api pytest tests/test_m11_ingestion.py -v`).
- Web tests: `cd web && npx vitest run <file>`. Typecheck: `cd web && npx tsc --noEmit`.
- Commit messages: Conventional Commits, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Precondition:** branch `feat/security-plaid-hardening` has uncommitted security work. Commit that first (user's call), then create `feat/plaid-deep-integration` from it. Do not mix this plan's commits into the security changes.

---

## Part C — UI fast wins

### Task 1: Remove the left-accent highlight

**Files:**
- Modify: `web/components/spend/category-drill.tsx:129`
- Modify: `web/components/spend/merchant-drill.tsx:97`

These are the only two occurrences of the `border-l-4 border-l-accent` pattern (verified by repo-wide grep). User wants this highlight style gone everywhere.

- [ ] **Step 1: Edit both files**

In `category-drill.tsx` line 129 and `merchant-drill.tsx` line 97, change:

```tsx
<div className="flex flex-col justify-center rounded-card-sm border border-l-4 border-l-accent border-border bg-card p-4 shadow-card lg:col-span-2">
```

to:

```tsx
<div className="flex flex-col justify-center rounded-card-sm border border-border bg-card p-4 shadow-card lg:col-span-2">
```

- [ ] **Step 2: Verify no other occurrences and tests still pass**

Run: `grep -rn "border-l-accent\|border-l-4" web --include="*.tsx" | grep -v node_modules`
Expected: no matches.
Run: `cd web && npx vitest run components/spend`
Expected: PASS (existing suites unaffected).

- [ ] **Step 3: Commit**

```bash
git add web/components/spend/category-drill.tsx web/components/spend/merchant-drill.tsx
git commit -m "style(spend): drop left-accent highlight from drill callouts"
```

### Task 2: Unified spend view — categories primary, merchants nested

**Files:**
- Modify: `web/lib/shell/nav.ts:81` (remove Merchants nav item)
- Modify: `web/app/(app)/transactions/page.tsx` (remove `view === "merchants"` branch, add global Top merchants card, redirect old deep links)
- Modify: `web/e2e/spend.spec.ts:46` (merchants e2e now goes through the default view)
- Test: `web/app/(app)/transactions/page.test.tsx` (update)

**Interfaces:**
- Consumes: `merchantRowsWithDeltas(txns, cats, from, to, prevFrom, prevTo): MerchantRow[]` and `<MerchantList rows currency onSelect />` — both already exist and are used by the current merchants view.
- Produces: `/transactions?view=merchants` redirects to `/transactions` (params otherwise preserved). Default view renders `data-testid="top-merchants-card"`.

The category drill already nests per-category top merchants (`category-drill.tsx:166`), so the drill side is done. This task removes the separate merchants page and surfaces a global merchants card on the default view.

- [ ] **Step 1: Update the failing test**

In `web/app/(app)/transactions/page.test.tsx`, add (adapting to the file's existing render helpers/mocks — it already renders the page with mocked `useTransactions`/`useCategories`):

```tsx
it("renders the global Top merchants card on the default view", async () => {
  renderPage(); // existing helper that mounts <TransactionsPage /> with providers
  expect(await screen.findByTestId("top-merchants-card")).toBeInTheDocument();
});

it("redirects legacy ?view=merchants deep links to the spend view", async () => {
  mockSearchParams("view=merchants"); // adapt to the file's search-params mock
  renderPage();
  await waitFor(() => expect(replaceMock).toHaveBeenCalled());
  const target = replaceMock.mock.calls.at(-1)?.[0] as string;
  expect(target).not.toContain("view=merchants");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run "app/(app)/transactions/page.test.tsx"`
Expected: FAIL — no `top-merchants-card`, no redirect.

- [ ] **Step 3: Implement in `page.tsx`**

(a) Redirect legacy links — add below the existing deep-link `useEffect` (~line 231):

```tsx
// Merchants merged into the spend view — redirect legacy ?view=merchants links.
useEffect(() => {
  if (view === "merchants") {
    const sp = new URLSearchParams(params.toString());
    sp.delete("view");
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [view]);
```

(b) Delete the entire `if (view === "merchants") { ... }` branch (lines 247–292). Change the chain to `if (view === "all") { ... } else { ... }`.

(c) In the default (categories) branch, compute merchant rows and render the card after `<CategoryList …/>` (~line 403):

```tsx
const merchantRows = merchantRowsWithDeltas(allTxns, allCats, from, to, prevFrom, prevTo);
```

```tsx
<CategoryList rows={catRows} currency={currency} onSelect={openCategory} />
<div data-testid="top-merchants-card">
  <MerchantList rows={merchantRows.slice(0, 8)} currency={currency} onSelect={openMerchant} />
</div>
```

(d) Simplify `rootBackLabel={view === "merchants" ? "Merchants" : "Spend"}` (line 417) to `rootBackLabel="Spend"`.

(e) In `web/lib/shell/nav.ts` delete line 81: `{ label: "Merchants", href: "/transactions?view=merchants" },`.

(f) In `web/e2e/spend.spec.ts` update the test at line 46: navigate to `/transactions` and assert the top-merchants card + merchant drill open, instead of `?view=merchants`.

- [ ] **Step 4: Run tests + typecheck**

Run: `cd web && npx vitest run "app/(app)/transactions/page.test.tsx" && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/\(app\)/transactions/page.tsx web/app/\(app\)/transactions/page.test.tsx web/lib/shell/nav.ts web/e2e/spend.spec.ts
git commit -m "feat(spend): merge merchants into categories-first spend view"
```

### Task 3: "Upcoming payments" strip on notifications

**Files:**
- Modify: `web/components/activity/activity-feed.tsx`
- Modify: `web/lib/activity/present.ts` (export the upcoming type set)
- Test: `web/components/activity/activity-feed.test.tsx` (create; if one exists, extend it)

**Interfaces:**
- Consumes: `useNotifications()` returns `Notification[]` with `type` (`loan_due`, `loan_penalty_risk`, …) and `payload`.
- Produces: feed renders `data-testid="upcoming-payments"` section pinned above history groups; loan_due/penalty items appear ONLY there. Debt cards already show "Next Due" (`web/components/debt/overview/debt-list.tsx:50`) — no debt-page work.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/activity/activity-feed.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActivityFeed } from "./activity-feed";

const notifications = [
  { id: "n1", type: "loan_due", status: "queued", scheduled_for: new Date().toISOString(), payload: { due_date: "2026-07-10", installment_no: 4 } },
  { id: "n2", type: "document_review", status: "queued", scheduled_for: new Date().toISOString(), payload: {} },
];

vi.mock("@/lib/api/notifications", () => ({
  useNotifications: () => ({ data: notifications, isLoading: false, isError: false }),
  useMarkRead: () => ({ mutate: vi.fn() }),
}));

describe("ActivityFeed", () => {
  it("pins payment-due items in the upcoming strip, not the history feed", () => {
    render(<ActivityFeed />);
    const upcoming = screen.getByTestId("upcoming-payments");
    expect(upcoming).toHaveTextContent("Payment due");
    const history = screen.getByTestId("activity-feed");
    expect(history).not.toHaveTextContent("Payment due");
    expect(history).toHaveTextContent("Receipt needs review");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/activity/activity-feed.test.tsx`
Expected: FAIL — `upcoming-payments` testid missing.

- [ ] **Step 3: Implement**

In `web/lib/activity/present.ts` add:

```ts
/** Forecast-type notifications: pinned in the Upcoming strip, kept out of history. */
export const UPCOMING_TYPES = new Set(["loan_due", "loan_penalty_risk"]);
```

In `activity-feed.tsx`, split before grouping and render the strip:

```tsx
import { present, GROUP_ORDER, UPCOMING_TYPES, type PresentedActivity } from "@/lib/activity/present";

const { upcoming, groups } = useMemo(() => {
  const all = q.data ?? [];
  const upcoming = all.filter((n) => UPCOMING_TYPES.has(n.type)).map(present);
  const items = all.filter((n) => !UPCOMING_TYPES.has(n.type)).map(present);
  const groups = GROUP_ORDER.map((g) => ({ group: g, items: items.filter((i) => i.group === g) })).filter(
    (x) => x.items.length > 0,
  );
  return { upcoming, groups };
}, [q.data]);
```

Render above the history `<div className="space-y-5" data-testid="activity-feed">`, inside a wrapping fragment:

```tsx
{upcoming.length > 0 && (
  <section className="space-y-2" data-testid="upcoming-payments">
    <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted">Upcoming payments</h3>
    <div className="rounded-2xl border border-border bg-card p-1 shadow-card">
      {upcoming.map((it) => (
        <Row key={it.id} it={it} onView={() => markRead.mutate(it.id)} />
      ))}
    </div>
  </section>
)}
```

Keep the "all caught up" empty state keyed on `upcoming.length === 0 && groups.length === 0`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/activity/activity-feed.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/activity/activity-feed.tsx web/components/activity/activity-feed.test.tsx web/lib/activity/present.ts
git commit -m "feat(notifications): pin payment-due items in an Upcoming strip"
```

---

## Part A — Plaid depth (backend)

### Task 4: Normalize ingest amount signs + carry Plaid categories

**Files:**
- Modify: `backend/app/ingestion/service.py` (`_to_create` in `plaid_sync` ~line 150; `sms_webhook` ~line 523)
- Test: `backend/tests/test_m11_ingestion.py`

**Interfaces:**
- Produces: Plaid txns stored with outflow NEGATIVE; `txn.flags["plaid_pfc"] = {"primary": ..., "detailed": ...}` when Plaid sends `personal_finance_category`. Tasks 7/9/10 depend on both.

Plaid reports outflow as positive; canonical storage is outflow-negative. The SMS path has the same inversion (`debit` stored positive). Fix both.

- [ ] **Step 1: Write the failing tests**

Add to `test_m11_ingestion.py` (extend `FakePlaid.sync_transactions`'s added row with `"personal_finance_category": {"primary": "FOOD_AND_DRINK", "detailed": "FOOD_AND_DRINK_RESTAURANT"}`):

```python
@pytest.mark.asyncio
async def test_plaid_amounts_negated_and_pfc_flagged(session):
    user = await _user(session)
    await plaid_exchange(session, user, PlaidExchangeIn(public_token="pt", institution_name="Bank", accounts=[{"account_id": "acc-1", "name": "Chk", "type": "depository", "subtype": "checking", "mask": "0000"}]), FakePlaid())
    await plaid_sync(session, user, PlaidSyncIn(), FakePlaid())
    txn = (await session.execute(select(Transaction).where(Transaction.household_id == user.household_id, Transaction.external_id == "txn-1"))).scalar_one()
    assert txn.amount == Decimal("-12.34")  # Plaid positive outflow -> stored negative
    assert (txn.flags or {}).get("plaid_pfc", {}).get("primary") == "FOOD_AND_DRINK"
```

Also update any existing assertion that expects `Decimal("12.34")` for Plaid txns, and the SMS test if it asserts sign (debit must now be negative).

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_m11_ingestion.py -v -k "negated or plaid"`
Expected: FAIL on amount sign.

- [ ] **Step 3: Implement**

In `_to_create` (service.py ~line 150):

```python
def _to_create(txn: dict) -> TransactionCreate:
    pfc = txn.get("personal_finance_category") or {}
    return TransactionCreate(
        account_id=accounts_by_id.get(txn.get("account_id")),
        merchant=txn.get("merchant_name") or txn.get("name"),
        # Plaid: positive = money out. Canonical storage: outflow negative.
        amount=-_money(txn.get("amount")),
        currency=_currency(txn.get("iso_currency_code")),
        txn_date=_date(txn.get("date")),
        status="draft",
        source_document_id=doc.id,
        source_channel="plaid",
        notes=txn.get("name"),
        confidence=1.0,
        external_id=txn.get("transaction_id"),
        flags={"plaid_pfc": {"primary": pfc.get("primary"), "detailed": pfc.get("detailed")}} if pfc else None,
    )
```

In `sms_webhook` (~line 523) replace the sign logic:

```python
amount = _money(parsed.amount)
if parsed.type != "credit":  # debit = money out -> negative (canonical)
    amount = -amount
```

- [ ] **Step 4: Run full module**

Run: `cd backend && python -m pytest tests/test_m11_ingestion.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/ingestion/service.py backend/tests/test_m11_ingestion.py
git commit -m "fix(ingestion): store Plaid/SMS outflows negative, carry Plaid PFC"
```

### Task 5: Link account filters + honest fallback account type

**Files:**
- Modify: `backend/app/ingestion/gateways.py` (`create_link_token`)
- Modify: `backend/app/ingestion/service.py` (`_account_type`, line 578)
- Modify: `backend/app/models/accounts.py:32` (add `"other"` to the enum)
- Create: `backend/alembic/versions/i7d4e5f6a8b9_m23_account_type_other.py`
- Test: `backend/tests/test_m11_ingestion.py`

**Interfaces:**
- Produces: Link picker limited to checking/savings/credit card/student/mortgage. `_account_type(kind, subtype)` returns `"other"` for anything unmapped.

- [ ] **Step 1: Write the failing test**

```python
def test_account_type_unknown_maps_to_other():
    assert service._account_type("investment", "hsa") == "other" or service._account_type("depository", "hsa") == "other"
    assert service._account_type(None, "cd") == "other"
    assert service._account_type("depository", "checking") == "checking"
    assert service._account_type("credit", "credit card") == "credit"
```

Note: current mapping sends `("investment","brokerage")` to `"investment"`; keep that (the type exists and is used in net worth) — only the catch-all changes. Adjust the first assertion to `service._account_type(None, "hsa") == "other"`.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_m11_ingestion.py -v -k account_type`
Expected: FAIL — returns `"checking"`.

- [ ] **Step 3: Implement**

`service.py` `_account_type`:

```python
def _account_type(kind: str | None, subtype: str | None) -> str:
    value = (subtype or kind or "").lower()
    if value in {"credit card", "credit"}:
        return "credit"
    if value in {"brokerage", "investment"}:
        return "investment"
    if value in {"savings"}:
        return "savings"
    if value in {"loan", "student", "mortgage"}:
        return "loan"
    if value in {"checking", "depository", ""}:
        return "checking"
    # Unmapped subtype (hsa/cd/401k/...) — Link filters should prevent this, but
    # if it arrives, label it honestly instead of pretending it's cash.
    return "other"
```

`models/accounts.py`: add `"other",` after `"investment",` in the `str_enum(...)` list.

Migration (the enum is a VARCHAR + CHECK constraint, `native_enum=False`):

```python
"""m23: allow 'other' account_logical.type

Revision ID: i7d4e5f6a8b9
Revises: h6c3d4e5f7a8
"""
from alembic import op

revision = "i7d4e5f6a8b9"
down_revision = "h6c3d4e5f7a8"
branch_labels = None
depends_on = None

_VALUES = "'checking','savings','credit','cash','loan','investment','other'"

def upgrade() -> None:
    op.execute("ALTER TABLE account_logical DROP CONSTRAINT IF EXISTS account_type")
    op.execute(f"ALTER TABLE account_logical ADD CONSTRAINT account_type CHECK (type IN ({_VALUES}))")

def downgrade() -> None:
    op.execute("ALTER TABLE account_logical DROP CONSTRAINT IF EXISTS account_type")
    op.execute("ALTER TABLE account_logical ADD CONSTRAINT account_type CHECK (type IN ('checking','savings','credit','cash','loan','investment'))")
```

Check the actual constraint name first (`docker compose exec db psql -U finance -c "\d account_logical"`); if SQLAlchemy prefixed it (e.g. `ck_account_logical_account_type`), use that name in both statements.

`gateways.py` `create_link_token` — add after the `request_args` dict:

```python
from plaid.model.link_token_account_filters import LinkTokenAccountFilters
from plaid.model.depository_filter import DepositoryFilter
from plaid.model.depository_account_subtypes import DepositoryAccountSubtypes
from plaid.model.depository_account_subtype import DepositoryAccountSubtype
from plaid.model.credit_filter import CreditFilter
from plaid.model.credit_account_subtypes import CreditAccountSubtypes
from plaid.model.credit_account_subtype import CreditAccountSubtype
from plaid.model.loan_filter import LoanFilter
from plaid.model.loan_account_subtypes import LoanAccountSubtypes
from plaid.model.loan_account_subtype import LoanAccountSubtype
```

(put these with the other lazy `plaid.model` imports inside the method)

```python
# Only surface account types the app actually supports; IRA/401k/HSA/CD etc.
# never appear in the Link picker.
request_args["account_filters"] = LinkTokenAccountFilters(
    depository=DepositoryFilter(account_subtypes=DepositoryAccountSubtypes([
        DepositoryAccountSubtype("checking"), DepositoryAccountSubtype("savings"),
    ])),
    credit=CreditFilter(account_subtypes=CreditAccountSubtypes([CreditAccountSubtype("credit card")])),
    loan=LoanFilter(account_subtypes=LoanAccountSubtypes([
        LoanAccountSubtype("student"), LoanAccountSubtype("mortgage"),
    ])),
)
```

- [ ] **Step 4: Run tests + apply migration**

Run: `cd backend && python -m pytest tests/test_m11_ingestion.py -v -k account_type` → PASS.
Run: `docker compose exec api alembic upgrade head` (or the project's migration command) → applies m23.
Manual check (sandbox creds set): request a link token via `/ingestion/plaid/link-token` and confirm 200.

- [ ] **Step 5: Commit**

```bash
git add backend/app/ingestion/gateways.py backend/app/ingestion/service.py backend/app/models/accounts.py backend/alembic/versions/i7d4e5f6a8b9_m23_account_type_other.py backend/tests/test_m11_ingestion.py
git commit -m "feat(plaid): filter Link to supported account types, honest fallback"
```

### Task 6: Balance snapshots on every sync

**Files:**
- Modify: `backend/app/ingestion/gateways.py` (add `get_accounts`)
- Modify: `backend/app/ingestion/service.py` (add `_sync_balances`, call from `plaid_sync`)
- Test: `backend/tests/test_m11_ingestion.py`

**Interfaces:**
- Consumes: `AccountBalance` model (`backend/app/models/accounts.py:53`) — unique `(account_id, as_of)`, constraint `account_balance_account_as_of_key`, balances stored as positive magnitudes (net worth applies sign by account type at read time — `analytics/service.py:143`).
- Produces: `PlaidGateway.get_accounts(access_token) -> dict | None`; `plaid_sync` result gains `"balances_written": int`. FakePlaid in tests needs a `get_accounts` method.

- [ ] **Step 1: Write the failing test**

Extend `FakePlaid`:

```python
    async def get_accounts(self, access_token: str) -> dict | None:
        return {"accounts": [{"account_id": "acc-1", "balances": {"current": 1500.55, "iso_currency_code": "USD"}}]}
```

```python
@pytest.mark.asyncio
async def test_plaid_sync_writes_balance_snapshots(session):
    user = await _user(session)
    await plaid_exchange(session, user, PlaidExchangeIn(public_token="pt", institution_name="Bank", accounts=[{"account_id": "acc-1", "name": "Chk", "type": "depository", "subtype": "checking"}]), FakePlaid())
    out = await plaid_sync(session, user, PlaidSyncIn(), FakePlaid())
    assert out["balances_written"] == 1
    from app.models.accounts import AccountBalance, AccountLogical
    acct = (await session.execute(select(AccountLogical).where(AccountLogical.household_id == user.household_id))).scalars().first()
    bal = (await session.execute(select(AccountBalance).where(AccountBalance.account_id == acct.id))).scalar_one()
    assert bal.balance == Decimal("1500.55")
    # re-sync same day upserts, doesn't duplicate
    out2 = await plaid_sync(session, user, PlaidSyncIn(), FakePlaid())
    count = (await session.execute(select(func.count()).select_from(AccountBalance).where(AccountBalance.account_id == acct.id))).scalar_one()
    assert count == 1
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_m11_ingestion.py -v -k balance`
Expected: FAIL — `AttributeError` / missing key.

- [ ] **Step 3: Implement**

`gateways.py` — mirror `get_liabilities` exactly (same skip-codes pattern):

```python
    async def get_accounts(self, access_token: str) -> dict | None:
        """Fetch current account balances. Returns None on expected product errors
        so a balance hiccup never fails the transaction sync."""
        if not self.settings.plaid_client_id or not self.settings.plaid_secret:
            raise IntegrationUnavailable("Plaid credentials are not configured")
        try:
            import plaid
            from plaid.api import plaid_api
            from plaid.model.accounts_balance_get_request import AccountsBalanceGetRequest
        except Exception as exc:  # noqa: BLE001
            raise IntegrationUnavailable("plaid-python is not installed") from exc
        env = getattr(plaid.Environment, self.settings.plaid_environment, plaid.Environment.Sandbox)
        client = plaid_api.PlaidApi(plaid.ApiClient(plaid.Configuration(host=env, api_key={"clientId": self.settings.plaid_client_id, "secret": self.settings.plaid_secret})))
        try:
            return client.accounts_balance_get(AccountsBalanceGetRequest(access_token=access_token)).to_dict()
        except Exception:  # noqa: BLE001
            return None  # balances are best-effort; sync must not fail
```

`service.py` — new helper near `_sync_liabilities`:

```python
async def _sync_balances(session: AsyncSession, user: User, payload: dict | None) -> int:
    """Upsert one AccountBalance snapshot per mapped account for today. Balances
    are stored as positive magnitudes; net worth applies the sign by account type."""
    if not payload:
        return 0
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from app.models.accounts import AccountBalance

    accounts_by_id = await _accounts_by_plaid_id(session, user.household_id)
    today = date.today()
    written = 0
    for acct in payload.get("accounts", []):
        account_id = accounts_by_id.get(acct.get("account_id"))
        current = (acct.get("balances") or {}).get("current")
        if account_id is None or current is None:
            continue
        stmt = pg_insert(AccountBalance).values(
            household_id=user.household_id, account_id=account_id, as_of=today, balance=_money(abs(Decimal(str(current)))),
        ).on_conflict_do_update(
            constraint="account_balance_account_as_of_key",
            set_={"balance": _money(abs(Decimal(str(current))))},
        )
        await session.execute(stmt)
        written += 1
    return written
```

In `plaid_sync`, after the liabilities block (line ~178):

```python
        balances_written += await _sync_balances(session, user, await gateway.get_accounts(token))
```

Initialize `balances_written = 0` alongside the other counters and add `"balances_written": balances_written` to the return dict.

- [ ] **Step 4: Run tests**

Run: `cd backend && python -m pytest tests/test_m11_ingestion.py -v`
Expected: PASS (other tests' FakePlaid now has get_accounts; if any local FakePlaid subclasses exist in other test functions, add the method there too).

- [ ] **Step 5: Commit**

```bash
git add backend/app/ingestion/gateways.py backend/app/ingestion/service.py backend/tests/test_m11_ingestion.py
git commit -m "feat(plaid): snapshot account balances every sync (live net worth)"
```

### Task 7: Loan/CC payment detection — auto-register, undoable

**Files:**
- Create: `backend/app/ingestion/plaid_matching.py`
- Modify: `backend/app/ingestion/service.py` (collect synced txn ids, call enrichment)
- Test: `backend/tests/test_m11_plaid_matching.py` (create)

**Interfaces:**
- Consumes: `loans_service.record_payment(session, user, loan_id, LoanPaymentIn(payment_date, amount, note))` (`backend/app/loans/service.py:106`) — commits and regenerates the schedule; `delete_payment` is the existing undo. `Loan.plaid_account_id` links Plaid liability accounts to loans.
- Produces: `enrich_after_sync(session, user, txn_ids: list[uuid.UUID]) -> dict` returning `{"payments_registered": int, "refunds_linked": int}` (refunds filled by Task 8). Flags written: liability leg + depository leg get `{"transfer": true, "loan_payment": true, "loan_id": <uuid str>}`; `LoanPayment.note = "plaid:<external_id>"` is the idempotency key.

Sign conventions (post-Task 4): depository outflow = negative; payment credit on a credit/loan account = positive.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_m11_plaid_matching.py
from __future__ import annotations

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.ingestion.plaid_matching import enrich_after_sync
from app.models.accounts import AccountLogical
from app.models.core import Household, User
from app.models.debt import Loan, LoanPayment
from app.models.transactions import Transaction
from app.transactions.schemas import TransactionCreate
from app.transactions import service as txn_service

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://finance:finance@localhost:5433/finance")
HOUSEHOLD_PREFIX = "pytest-m11pm-"


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
        await conn.execute(text("DELETE FROM household WHERE name LIKE :p"), {"p": f"{HOUSEHOLD_PREFIX}%"})
    await eng.dispose()


@pytest_asyncio.fixture
async def session(engine):
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with sm() as s:
        yield s


async def _fixture(session):
    hh = Household(name=f"{HOUSEHOLD_PREFIX}{uuid.uuid4().hex[:8]}", base_currency="USD")
    session.add(hh)
    await session.flush()
    user = User(household_id=hh.id, email=f"{uuid.uuid4().hex}@example.com", password_hash="x", role="owner")
    session.add(user)
    await session.flush()
    chk = AccountLogical(household_id=hh.id, owner_user_id=user.id, label="Checking", type="checking", currency="USD", is_shared=False, plaid_account_id="p-chk")
    card = AccountLogical(household_id=hh.id, owner_user_id=user.id, label="Card", type="credit", currency="USD", is_shared=False, plaid_account_id="p-card")
    session.add_all([chk, card])
    loan = Loan(household_id=hh.id, owner_user_id=user.id, name="Plaid Credit Card", type="credit_card", schedule_kind="revolving", principal=Decimal("2000.00"), currency="USD", plaid_account_id="p-card")
    session.add(loan)
    await session.commit()
    return user, chk, card, loan


async def _txn(session, user, account, amount, day, external_id, flags=None, merchant="BANK"):
    return await txn_service.create_transaction(session, user, TransactionCreate(
        account_id=account.id, merchant=merchant, amount=Decimal(amount), currency="USD",
        txn_date=date(2026, 6, day), status="draft", source_channel="plaid",
        external_id=external_id, flags=flags,
    ))


@pytest.mark.asyncio
async def test_pair_match_registers_payment_and_flags_transfer(session):
    user, chk, card, loan = await _fixture(session)
    out_leg = await _txn(session, user, chk, "-250.00", 10, "t-out")
    in_leg = await _txn(session, user, card, "250.00", 11, "t-in")
    result = await enrich_after_sync(session, user, [out_leg.id, in_leg.id])
    assert result["payments_registered"] == 1
    payment = (await session.execute(select(LoanPayment).where(LoanPayment.loan_id == loan.id))).scalar_one()
    assert payment.amount == Decimal("250.00")
    assert payment.note == "plaid:t-in"
    for txn_id in (out_leg.id, in_leg.id):
        txn = await session.get(Transaction, txn_id)
        assert (txn.flags or {}).get("transfer") is True
        assert (txn.flags or {}).get("loan_id") == str(loan.id)


@pytest.mark.asyncio
async def test_pair_match_is_idempotent(session):
    user, chk, card, loan = await _fixture(session)
    out_leg = await _txn(session, user, chk, "-250.00", 10, "t-out")
    in_leg = await _txn(session, user, card, "250.00", 11, "t-in")
    await enrich_after_sync(session, user, [out_leg.id, in_leg.id])
    again = await enrich_after_sync(session, user, [out_leg.id, in_leg.id])
    assert again["payments_registered"] == 0
    payments = (await session.execute(select(LoanPayment).where(LoanPayment.loan_id == loan.id))).scalars().all()
    assert len(payments) == 1


@pytest.mark.asyncio
async def test_single_leg_pfc_match(session):
    user, chk, card, loan = await _fixture(session)
    t = await _txn(session, user, chk, "-410.00", 12, "t-pfc", flags={"plaid_pfc": {"primary": "LOAN_PAYMENTS", "detailed": "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"}})
    result = await enrich_after_sync(session, user, [t.id])
    assert result["payments_registered"] == 1
    payment = (await session.execute(select(LoanPayment).where(LoanPayment.loan_id == loan.id))).scalar_one()
    assert payment.amount == Decimal("410.00")


@pytest.mark.asyncio
async def test_single_leg_skipped_when_ambiguous(session):
    user, chk, card, loan = await _fixture(session)
    loan2 = Loan(household_id=user.household_id, owner_user_id=user.id, name="Plaid Student Loan", type="education", schedule_kind="amortizing", principal=Decimal("9000.00"), currency="USD", plaid_account_id="p-stu")
    session.add(loan2)
    await session.commit()
    t = await _txn(session, user, chk, "-410.00", 12, "t-ambig", flags={"plaid_pfc": {"primary": "LOAN_PAYMENTS", "detailed": ""}})
    result = await enrich_after_sync(session, user, [t.id])
    assert result["payments_registered"] == 0  # two candidate loans, no name signal -> don't guess
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_m11_plaid_matching.py -v`
Expected: FAIL — `ModuleNotFoundError: app.ingestion.plaid_matching`.

- [ ] **Step 3: Implement `plaid_matching.py`**

```python
"""Post-sync enrichment for Plaid transactions: loan/credit-card payment
detection (auto-registered, undoable via loan payment delete) and refund
matching. Called from plaid_sync; must never raise into the sync path.

Sign conventions (canonical storage): money out is negative. A payment shows
up as a negative leg on a depository account and a positive leg on the
credit/loan account it pays down.
"""
from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.loans import service as loans_service
from app.loans.schemas import LoanPaymentIn
from app.models.accounts import AccountLogical
from app.models.core import User
from app.models.debt import Loan, LoanPayment
from app.models.transactions import Transaction

logger = logging.getLogger(__name__)

PAIR_WINDOW_DAYS = 3
REFUND_WINDOW_DAYS = 90
_LIABILITY_TYPES = {"credit", "loan"}
_DEPOSITORY_TYPES = {"checking", "savings", "cash"}


async def enrich_after_sync(session: AsyncSession, user: User, txn_ids: list[uuid.UUID]) -> dict:
    counts = {"payments_registered": 0, "refunds_linked": 0}
    if not txn_ids:
        return counts
    txns = list((await session.execute(
        select(Transaction).where(Transaction.household_id == user.household_id, Transaction.id.in_(txn_ids))
    )).scalars().all())
    accounts = {a.id: a for a in (await session.execute(
        select(AccountLogical).where(AccountLogical.household_id == user.household_id)
    )).scalars().all()}
    loans_by_plaid = {l.plaid_account_id: l for l in (await session.execute(
        select(Loan).where(Loan.household_id == user.household_id, Loan.plaid_account_id.is_not(None))
    )).scalars().all() if l.plaid_account_id}

    counts["payments_registered"] += await _match_payment_pairs(session, user, txns, accounts, loans_by_plaid)
    counts["payments_registered"] += await _match_single_leg_payments(session, user, txns, accounts, loans_by_plaid)
    counts["refunds_linked"] += await _match_refunds(session, user, txns, accounts)
    await session.commit()
    return counts


def _set_flags(txn: Transaction, **new: object) -> None:
    txn.flags = {**(txn.flags or {}), **new}
    flag_modified(txn, "flags")


async def _payment_exists(session: AsyncSession, note: str) -> bool:
    row = (await session.execute(select(LoanPayment.id).where(LoanPayment.note == note))).first()
    return row is not None


async def _register(session: AsyncSession, user: User, loan: Loan, amount: Decimal, payment_date, note: str) -> bool:
    if await _payment_exists(session, note):
        return False
    await loans_service.record_payment(session, user, loan.id, LoanPaymentIn(payment_date=payment_date, amount=amount, note=note))
    return True


async def _match_payment_pairs(session, user, txns, accounts, loans_by_plaid) -> int:
    """Positive leg on a credit/loan account + equal-magnitude negative leg on a
    depository account within PAIR_WINDOW_DAYS -> loan payment."""
    registered = 0
    liability_legs = [
        t for t in txns
        if t.account_id and (a := accounts.get(t.account_id)) and a.type in _LIABILITY_TYPES
        and t.amount > 0 and not (t.flags or {}).get("transfer")
    ]
    for leg in liability_legs:
        account = accounts[leg.account_id]
        loan = loans_by_plaid.get(account.plaid_account_id or "")
        if loan is None:
            continue
        # The other leg may predate this sync batch — search the whole ledger.
        window_lo = leg.txn_date - timedelta(days=PAIR_WINDOW_DAYS)
        window_hi = leg.txn_date + timedelta(days=PAIR_WINDOW_DAYS)
        candidates = list((await session.execute(
            select(Transaction).where(
                Transaction.household_id == user.household_id,
                Transaction.amount == -leg.amount,
                Transaction.txn_date >= window_lo,
                Transaction.txn_date <= window_hi,
                Transaction.id != leg.id,
            )
        )).scalars().all())
        other = next(
            (c for c in candidates
             if c.account_id and (a := accounts.get(c.account_id)) and a.type in _DEPOSITORY_TYPES
             and not (c.flags or {}).get("transfer")),
            None,
        )
        if other is None:
            continue
        note = f"plaid:{leg.external_id or leg.id}"
        if await _register(session, user, loan, leg.amount, leg.txn_date, note):
            registered += 1
        _set_flags(leg, transfer=True, loan_payment=True, loan_id=str(loan.id))
        _set_flags(other, transfer=True, loan_payment=True, loan_id=str(loan.id))
    return registered


async def _match_single_leg_payments(session, user, txns, accounts, loans_by_plaid) -> int:
    """Depository outflow Plaid labels LOAN_PAYMENTS -> register when we can
    pin down exactly one loan (never guess between several)."""
    registered = 0
    plaid_loans = list(loans_by_plaid.values())
    for t in txns:
        flags = t.flags or {}
        if flags.get("transfer") or flags.get("loan_payment"):
            continue
        if (flags.get("plaid_pfc") or {}).get("primary") != "LOAN_PAYMENTS":
            continue
        account = accounts.get(t.account_id) if t.account_id else None
        if account is None or account.type not in _DEPOSITORY_TYPES or t.amount >= 0:
            continue
        loan = _resolve_loan(t, plaid_loans, flags)
        if loan is None:
            continue
        note = f"plaid:{t.external_id or t.id}"
        if await _register(session, user, loan, -t.amount, t.txn_date, note):
            registered += 1
        _set_flags(t, transfer=True, loan_payment=True, loan_id=str(loan.id))
    return registered


def _resolve_loan(txn: Transaction, loans: list[Loan], flags: dict) -> Loan | None:
    if len(loans) == 1:
        return loans[0]
    detailed = ((flags.get("plaid_pfc") or {}).get("detailed") or "").upper()
    if "CREDIT_CARD" in detailed:
        cards = [l for l in loans if l.type == "credit_card"]
        if len(cards) == 1:
            return cards[0]
    haystack = (txn.notes or "").lower()  # Plaid puts the raw descriptor in notes
    named = [l for l in loans if any(tok for tok in l.name.lower().split() if len(tok) > 3 and tok in haystack)]
    if len(named) == 1:
        return named[0]
    return None  # ambiguous -> leave it; user can record manually


async def _match_refunds(session, user, txns, accounts) -> int:
    return 0  # Task 8
```

- [ ] **Step 4: Wire into `plaid_sync`** (`service.py`)

Collect ids and call after the removed-loop (before liabilities):

```python
        synced_ids: list[uuid.UUID] = []
        for txn in added:
            created = await txn_service.create_transaction(session, user, _to_create(txn))
            synced_ids.append(created.id)
            txns_created += 1
        for txn in modified:
            updated = await txn_service.create_transaction(session, user, _to_create(txn), update_on_conflict=True)
            synced_ids.append(updated.id)
            txns_updated += 1
```

and after the liabilities/balances block:

```python
        try:
            enriched = await plaid_matching.enrich_after_sync(session, user, synced_ids)
            payments_registered += enriched["payments_registered"]
            refunds_linked += enriched["refunds_linked"]
        except Exception:  # noqa: BLE001 — enrichment must never fail the sync
            logger.exception("plaid enrichment failed for item %s", item.id)
```

Add `from app.ingestion import plaid_matching` and `import logging` / `logger = logging.getLogger(__name__)` at module top (match existing style), initialize `payments_registered, refunds_linked = 0, 0`, and extend the return dict with `"payments_registered"` and `"refunds_linked"`. Also add the two keys to `PlaidSyncOut` if `backend/app/ingestion/schemas.py` types the response; mirror in `shared/api-schema.ts` via the project's schema regeneration step if one exists (check `package.json` scripts for `openapi`/`schema`).

- [ ] **Step 5: Run tests**

Run: `cd backend && python -m pytest tests/test_m11_plaid_matching.py tests/test_m11_ingestion.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/ingestion/plaid_matching.py backend/app/ingestion/service.py backend/tests/test_m11_plaid_matching.py backend/app/ingestion/schemas.py
git commit -m "feat(plaid): auto-register detected loan/CC payments (undoable)"
```

### Task 8: Refund detection and linking

**Files:**
- Modify: `backend/app/ingestion/plaid_matching.py` (implement `_match_refunds`)
- Test: `backend/tests/test_m11_plaid_matching.py`

**Interfaces:**
- Produces: refund txn gets `flags.refund = true`, `flags.refund_of = <original txn id>`; original gets `flags.refunded_by = <refund txn id>`. Unmatched credits on spend accounts still get `flags.refund = true` (no link). Task 9 keys analytics off `flags.refund` / `flags.transfer`.

- [ ] **Step 1: Write the failing tests**

```python
@pytest.mark.asyncio
async def test_refund_links_to_original_purchase(session):
    user, chk, card, loan = await _fixture(session)
    purchase = await _txn(session, user, card, "-89.99", 5, "t-buy", merchant="Amazon")
    refund = await _txn(session, user, card, "89.99", 15, "t-refund", merchant="Amazon")
    result = await enrich_after_sync(session, user, [refund.id])
    assert result["refunds_linked"] == 1
    refund = await session.get(Transaction, refund.id)
    purchase = await session.get(Transaction, purchase.id)
    assert (refund.flags or {}).get("refund") is True
    assert (refund.flags or {}).get("refund_of") == str(purchase.id)
    assert (purchase.flags or {}).get("refunded_by") == str(refund.id)


@pytest.mark.asyncio
async def test_unmatched_credit_still_flagged_refund(session):
    user, chk, card, loan = await _fixture(session)
    credit = await _txn(session, user, card, "12.00", 15, "t-credit", merchant="RandomShop")
    result = await enrich_after_sync(session, user, [credit.id])
    assert result["refunds_linked"] == 0
    credit = await session.get(Transaction, credit.id)
    assert (credit.flags or {}).get("refund") is True
    assert "refund_of" not in (credit.flags or {})
```

Note the card-account inflow ambiguity: a positive amount on a credit account is a payment when it pair-matches a depository leg (Task 7 runs first and flags it `transfer`), otherwise a merchant refund. Order inside `enrich_after_sync` already guarantees this.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_m11_plaid_matching.py -v -k refund`
Expected: FAIL — `refunds_linked == 0` / flags missing.

- [ ] **Step 3: Implement `_match_refunds`**

```python
async def _match_refunds(session, user, txns, accounts) -> int:
    """Merchant-side credits: flag as refund and link to the matching purchase
    (same merchant, equal magnitude, within REFUND_WINDOW_DAYS before)."""
    linked = 0
    for t in txns:
        flags = t.flags or {}
        if t.amount <= 0 or flags.get("transfer") or flags.get("refund"):
            continue
        account = accounts.get(t.account_id) if t.account_id else None
        if account is not None and account.type == "loan":
            continue  # loan inflows are payments/disbursements, not refunds
        if t.merchant_id is None:
            continue  # no merchant signal — leave for manual review
        original = (await session.execute(
            select(Transaction).where(
                Transaction.household_id == user.household_id,
                Transaction.merchant_id == t.merchant_id,
                Transaction.amount == -t.amount,
                Transaction.txn_date <= t.txn_date,
                Transaction.txn_date >= t.txn_date - timedelta(days=REFUND_WINDOW_DAYS),
                Transaction.id != t.id,
            ).order_by(Transaction.txn_date.desc())
        )).scalars().first()
        if original is not None and not (original.flags or {}).get("refunded_by"):
            _set_flags(t, refund=True, refund_of=str(original.id))
            _set_flags(original, refunded_by=str(t.id))
            linked += 1
        else:
            _set_flags(t, refund=True)
    return linked
```

- [ ] **Step 4: Run tests**

Run: `cd backend && python -m pytest tests/test_m11_plaid_matching.py -v`
Expected: PASS (all Task 7 + 8 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/ingestion/plaid_matching.py backend/tests/test_m11_plaid_matching.py
git commit -m "feat(plaid): detect refunds and link them to the original purchase"
```

### Task 9: Net transfers/refunds out of spend analytics (backend + web)

**Files:**
- Modify: `backend/app/analytics/service.py` (`_aggregate`, ~line 228)
- Modify: `web/lib/spend/derive.ts` (`spendAmount`, line 33)
- Test: `backend/tests/test_m7_analytics.py` (extend — find the file with `grep -rl "_aggregate\|aggregate" backend/tests`; if none fits, create `backend/tests/test_m7_spend_flags.py` reusing the engine/session fixture pattern from `test_m11_plaid_matching.py`)
- Test: `web/lib/spend/derive.test.ts` (extend or create)

**Interfaces:**
- Consumes: `flags.transfer`, `flags.refund` from Tasks 7/8.
- Produces: transfer-flagged txns invisible to spend/aggregate; refund-flagged inflows subtract from their category/merchant totals in BOTH backend `_aggregate` and web `spendAmount` (used by every spend surface: lists, drills, series, donut).

- [ ] **Step 1: Write failing web test**

```ts
// web/lib/spend/derive.test.ts (add)
import { describe, expect, it } from "vitest";
import { spendAmount, rangeSpend } from "./derive";

const cats = [{ id: "c1", name: "Shopping", parent_id: null }] as never[];
const byIdCats = cats;

function txn(amount: number, flags: Record<string, unknown> | null = null) {
  return { id: "t", amount: String(amount), currency: "USD", txn_date: "2026-06-10", category_id: "c1", flags } as never;
}

describe("spendAmount flags", () => {
  it("ignores transfer legs entirely", () => {
    expect(rangeSpend([txn(-250, { transfer: true })], byIdCats, "2026-06-01", "2026-06-30")).toBe(0);
  });
  it("nets refunds against spend", () => {
    const total = rangeSpend([txn(-89.99), txn(89.99, { refund: true })], byIdCats, "2026-06-01", "2026-06-30");
    expect(total).toBeCloseTo(0);
  });
  it("still ignores plain inflows", () => {
    expect(rangeSpend([txn(500)], byIdCats, "2026-06-01", "2026-06-30")).toBe(0);
  });
});
```

(Adapt the `txn`/`cats` shapes to the existing test file's fixtures if `derive.test.ts` already exists.)

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run lib/spend/derive.test.ts`
Expected: FAIL — refund case returns 89.99... wait, refund inflow currently returns 0 from `spendAmount`, so total is 89.99 for the purchase; expected 0 → FAIL. Transfer case returns 250 → FAIL.

- [ ] **Step 3: Implement web `spendAmount`**

```ts
export function spendAmount(t: Transaction, byId: Map<string, Category>): number {
  const a = Number(t.amount);
  const flags = (t.flags ?? {}) as Record<string, unknown>;
  if (flags.transfer) return 0; // loan/CC payment legs are money movement, not spend
  if (a >= 0) return flags.refund ? -a : 0; // refunds net against their category
  if (NON_SPEND_PARENTS.has(topCategory(t, byId).name.toLowerCase())) return 0;
  return -a;
}
```

Callers that clamp (`largestPurchase` filters `> 0`, drill merchant lists skip `spend === 0`) keep working; negative refund contributions flow through the sums.

- [ ] **Step 4: Backend `_aggregate`**

In the txn loop (analytics/service.py:228):

```python
    for txn in txns:
        flags = txn.flags or {}
        if flags.get("transfer"):
            continue  # payment/transfer legs are money movement, not spend
        is_income = _is_income_transaction(txn, category_rows)
        if spend_only and is_income:
            continue
        items = line_items.get(txn.id, []) if "item_type" in dims else []
        if items:
            entries = [(item, abs(_money(item.amount)) if not is_income else _money(item.amount), item.quantity) for item in items]
        else:
            amount = _money(txn.base_amount if txn.base_amount is not None else txn.amount)
            if is_income:
                entries = [(None, amount, None)]
            elif flags.get("refund"):
                entries = [(None, -abs(amount), None)]  # refunds net the category down
            else:
                entries = [(None, abs(amount), None)]
```

Backend test — create `backend/tests/test_m7_spend_flags.py` with the same engine/session/`_fixture`/`_txn` helpers as `test_m11_plaid_matching.py` (copy them; tests may run out of order), plus:

```python
from app.analytics import service as analytics_service
from app.models.transactions import Category


@pytest.mark.asyncio
async def test_breakdown_nets_refunds_and_skips_transfers(session):
    user, chk, card, loan = await _fixture(session)
    cat = Category(household_id=user.household_id, name="Shopping", kind="category")
    session.add(cat)
    await session.commit()

    async def _cat_txn(amount, day, ext, flags=None):
        t = await _txn(session, user, card, amount, day, ext, flags=flags, merchant="Amazon")
        t.category_id = cat.id
        await session.commit()
        return t

    await _cat_txn("-100.00", 5, "t-buy2")
    await _cat_txn("100.00", 8, "t-ref2", flags={"refund": True})
    transfer = await _txn(session, user, chk, "-250.00", 9, "t-tr2", flags={"transfer": True})
    transfer.category_id = cat.id
    await session.commit()

    out = await analytics_service.breakdown(session, user, "category", None, date(2026, 6, 1), date(2026, 6, 30))
    shopping = [r for r in out["rows"] if r["dimensions"].get("category") == "Shopping"]
    total = shopping[0]["total"] if shopping else Decimal("0.00")
    assert total == Decimal("0.00")  # refund nets the purchase; transfer leg never counted
```

(`breakdown` is the public entrypoint `analytics/router.py` uses over `_aggregate` — `backend/app/analytics/service.py:128`. Note `breakdown` passes `spend_only=True`; the refund-flagged txn must not be classified as income by `_is_income_transaction`, which it isn't — its category is Shopping.)

- [ ] **Step 5: Run both suites**

Run: `cd web && npx vitest run lib/spend/derive.test.ts && cd ../backend && python -m pytest tests/ -v -k "refund or transfer or aggregate"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/lib/spend/derive.ts web/lib/spend/derive.test.ts backend/app/analytics/service.py backend/tests/
git commit -m "feat(analytics): net refunds and hide transfer legs from spend"
```

### Task 10: Plaid category fallback in categorization

**Files:**
- Modify: `backend/app/transactions/service.py` (`apply_categorization`, line 105)
- Test: `backend/tests/test_m6_transactions.py` (extend; find via `grep -rl "apply_categorization" backend/tests`, else add to the Task 7 test file)

**Interfaces:**
- Consumes: `txn.flags["plaid_pfc"]["primary"]` (Task 4).
- Produces: final fallback layer after rules → merchant default → name similarity. User edits still win (fallback only fires when `category_id is None`) and still write rules.

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.asyncio
async def test_plaid_pfc_fallback_categorizes(session):
    user = await _user(session)  # reuse the file's user fixture
    from app.models.transactions import Category
    cat = Category(household_id=user.household_id, name="Food & Dining", kind="category")
    session.add(cat)
    await session.commit()
    txn = await txn_service.create_transaction(session, user, TransactionCreate(
        merchant=f"unseen-merchant-{uuid.uuid4().hex[:6]}", amount=Decimal("-23.45"), currency="USD",
        txn_date=date(2026, 6, 20), status="draft", source_channel="plaid",
        external_id=f"t-pfc-{uuid.uuid4().hex[:6]}",
        flags={"plaid_pfc": {"primary": "FOOD_AND_DRINK", "detailed": "FOOD_AND_DRINK_RESTAURANT"}},
    ))
    assert txn.category_id == cat.id
```

(Use a merchant name random enough that name-similarity can't fire first.)

- [ ] **Step 2: Run to verify failure**

Expected: FAIL — `category_id is None`.

- [ ] **Step 3: Implement**

In `transactions/service.py`, add below `_category_by_name_similarity`:

```python
# Plaid personal_finance_category primary -> search terms against the household's
# category tree. Deliberately fuzzy: household category names vary.
_PFC_SEARCH_TERMS: dict[str, list[str]] = {
    "FOOD_AND_DRINK": ["food", "dining", "restaurant", "grocer"],
    "GENERAL_MERCHANDISE": ["shopping", "merchandise"],
    "TRANSPORTATION": ["transport", "car", "gas", "fuel"],
    "TRAVEL": ["travel"],
    "RENT_AND_UTILITIES": ["utilit", "rent", "bill"],
    "ENTERTAINMENT": ["entertainment", "fun", "leisure"],
    "PERSONAL_CARE": ["personal", "care", "beauty"],
    "GENERAL_SERVICES": ["service"],
    "MEDICAL": ["health", "medical"],
    "HOME_IMPROVEMENT": ["home"],
    "EDUCATION": ["education", "school"],
}


async def _category_from_plaid_pfc(session: AsyncSession, txn: Transaction) -> uuid.UUID | None:
    primary = ((txn.flags or {}).get("plaid_pfc") or {}).get("primary")
    terms = _PFC_SEARCH_TERMS.get(primary or "")
    if not terms:
        return None
    for term in terms:
        row = (await session.execute(
            select(Category.id).where(
                or_(Category.household_id == txn.household_id, Category.household_id.is_(None)),
                Category.kind == "category",
                Category.name.ilike(f"%{term}%"),
            ).limit(1)
        )).first()
        if row:
            return row[0]
    return None
```

(Check the file's existing imports — `or_` and `Category` are likely already imported for `_category_by_name_similarity`; match how that function scopes household vs system categories and copy its predicate style.)

In `apply_categorization` add the final fallback:

```python
    if category_id is None:
        category_id = await _category_from_plaid_pfc(session, txn)
```

- [ ] **Step 4: Run tests**

Run: `cd backend && python -m pytest tests/ -v -k "pfc or categoriz"`
Expected: PASS, plus the whole `test_m6`/`test_m11` modules stay green.

- [ ] **Step 5: Commit**

```bash
git add backend/app/transactions/service.py backend/tests/
git commit -m "feat(transactions): fall back to Plaid category when rules miss"
```

### Task 11: Sandbox data guidance (docs only)

**Files:**
- Modify: `web/.env.example` (or `backend/.env.example` — whichever holds the Plaid vars; check both)
- Modify: `web/app/(app)/connections/` — the Plaid connect card component (find via `grep -rln "link_token\|PlaidLink" web/app web/components | grep -i connect`)

- [ ] **Step 1: Add env comment**

Next to the Plaid vars:

```bash
# Plaid sandbox: the default user (user_good/pass_good) returns a small static
# transaction set. Log into Link with user_transactions_dynamic / pass_good for
# continuously generated realistic transactions on every sync.
```

- [ ] **Step 2: Add a sandbox hint in the connections UI**

In the Plaid connect card, render (only when the card is shown; keep copy honest per repo rules):

```tsx
<p className="text-xs text-muted">
  Sandbox tip: sign in with <code>user_transactions_dynamic</code> / <code>pass_good</code> to
  get a realistic, continuously updating transaction feed.
</p>
```

Gate it if an env flag distinguishes sandbox (check `NEXT_PUBLIC_` vars in `web/.env.example`); if none exists, include it unconditionally with the "Sandbox tip" prefix.

- [ ] **Step 3: Commit**

```bash
git add web/.env.example backend/.env.example web/
git commit -m "docs(plaid): sandbox dynamic-transactions guidance"
```

---

## Part B — Gmail transaction events

### Task 12: Gmail gateway — message ids, dates, wider query

**Files:**
- Modify: `backend/app/ingestion/gateways.py` (`fetch_messages`, line 171)
- Modify: `backend/app/ingestion/schemas.py` (`EmailInboundIn`, line 83)
- Test: `backend/tests/test_m11_ingestion.py` (existing `test_email_sync_ingests_attachment_as_document` keeps passing)

**Interfaces:**
- Produces: each message dict gains `"message_id": str` and `"received_at": datetime iso str`; `EmailInboundIn` gains `message_id: str | None = None`. Task 13 uses `message_id` for dedup and `received_at` for txn_date.

- [ ] **Step 1: Implement**

In `fetch_messages`, widen the query and capture id/date:

```python
            listed = svc.users().messages().list(
                userId="me",
                q="newer_than:30d (statement OR transaction OR receipt OR paystub OR alert OR charged OR payment OR invoice OR order)",
                maxResults=25,
            ).execute()
```

and in the per-message loop:

```python
                internal_ms = msg.get("internalDate")
                received_at = (
                    datetime.fromtimestamp(int(internal_ms) / 1000, tz=timezone.utc).isoformat()
                    if internal_ms else None
                )
                messages.append({
                    "message_id": msg.get("id"),
                    "from_address": headers.get("from") or "unknown",
                    "subject": headers.get("subject"),
                    "body": body or msg.get("snippet"),
                    "received_at": received_at,
                    "attachments": attachments,
                })
```

Add `from datetime import datetime, timezone` at gateway module top.

In `schemas.py`:

```python
class EmailInboundIn(BaseModel):
    from_address: str
    subject: str | None = None
    body: str | None = None
    received_at: datetime | None = None
    message_id: str | None = None
    attachments: list[dict] = Field(default_factory=list)
```

- [ ] **Step 2: Run existing email tests**

Run: `cd backend && python -m pytest tests/test_m11_ingestion.py -v -k email`
Expected: PASS (new fields optional).

- [ ] **Step 3: Commit**

```bash
git add backend/app/ingestion/gateways.py backend/app/ingestion/schemas.py
git commit -m "feat(gmail): carry message ids and received dates, widen sync query"
```

### Task 13: Parse email bodies into draft transactions

**Files:**
- Modify: `backend/app/ingestion/schemas.py` (add `EmailParsed`)
- Modify: `backend/app/ingestion/service.py` (`email_sync`, line 453; add `_parse_email`)
- Modify: `backend/app/ingestion/router.py` (email sync endpoint passes an LLM client if it doesn't already — mirror how the SMS webhook endpoint obtains one)
- Test: `backend/tests/test_m11_ingestion.py`

**Interfaces:**
- Consumes: `_parse_sms`-style LLM call (`llm.chat(..., json_schema=EmailParsed, purpose="email.parse", ...)`), `_regex_sms(body)` as no-LLM fallback, `create_transaction` dedup on `(source_channel, external_id)`.
- Produces: draft txns with `source_channel="email"`, `external_id=f"email:{conn.id}:{message_id}"`, outflow negative. Body parsing only when the message produced NO attachments (attachments go through OCR and would double-count).

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.asyncio
async def test_email_sync_parses_body_into_draft_transaction(session):
    user = await _user(session)
    conn = await _connect_email(session, user)  # existing helper
    class FakeGmail:
        async def fetch_messages(self, token):
            return [{
                "message_id": "gm-1",
                "from_address": "alerts@bank.com",
                "subject": "Card charged",
                "body": "Your card was charged $23.45 at STARBUCKS on 2026-06-20",
                "received_at": "2026-06-20T10:00:00+00:00",
                "attachments": [],
            }]
    out = await service.email_sync(session, user, FakeGmail())
    assert out["transactions_created"] == 1
    txn = (await session.execute(select(Transaction).where(Transaction.household_id == user.household_id, Transaction.source_channel == "email"))).scalar_one()
    assert txn.amount == Decimal("-23.45")
    assert txn.status == "draft"
    assert txn.external_id.startswith("email:")
    # second sync of the same message dedups
    out2 = await service.email_sync(session, user, FakeGmail())
    assert out2["transactions_created"] == 0
```

(No LLM in tests → `_parse_email` falls back to the regex parser, which handles "$23.45 ... at STARBUCKS". `email_sync` gets the LLM client itself; in tests `get_household_llm_client` returns None/unconfigured — check how `sms_webhook` behaves in the existing SMS test and mirror it. If it constructs a real client, give `email_sync` an optional `llm: LLMClient | None = None` parameter defaulting to skip-LLM in tests, exactly like `sms_webhook(session, token, data, llm=None)` does.)

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest tests/test_m11_ingestion.py -v -k parses_body`
Expected: FAIL — `transactions_created` key missing.

- [ ] **Step 3: Implement**

`schemas.py`:

```python
class EmailParsed(BaseModel):
    is_transaction: bool = False
    merchant: str | None = None
    amount: Decimal | None = None
    currency: str = "USD"
    date: str | None = None
    type: str = "debit"  # debit | credit
    confidence: float = Field(default=0.0, ge=0, le=1)
```

`service.py` — parser next to `_parse_sms`:

```python
async def _parse_email(payload: EmailInboundIn, llm: LLMClient | None, user: User, session: AsyncSession) -> EmailParsed | None:
    text = f"Subject: {payload.subject or ''}\nFrom: {payload.from_address}\n\n{(payload.body or '')[:4000]}"
    if llm is not None:
        try:
            out = await llm.chat(
                [{"role": "user", "content": "Decide if this email describes a single money transaction (bank/card alert or merchant receipt). If yes set is_transaction=true and extract merchant, amount, ISO currency, date (YYYY-MM-DD), type debit|credit, confidence. Email:\n" + text}],
                json_schema=EmailParsed, purpose="email.parse", user_id=user.id, session=session,
            )
            return EmailParsed.model_validate(out)
        except Exception:  # noqa: BLE001 — fall back to regex, never fail the sync
            pass
    rx = _regex_sms(payload.body or "")
    if rx is None:
        return None
    return EmailParsed(is_transaction=True, merchant=rx.merchant, amount=rx.amount, currency=rx.currency, date=rx.date, type=rx.type, confidence=rx.confidence)
```

Rework `email_sync`:

```python
async def email_sync(session: AsyncSession, user: User, gateway: GmailGateway, llm: LLMClient | None = None) -> dict:
    conn = (await session.execute(select(IngestionConnection).where(IngestionConnection.user_id == user.id, IngestionConnection.channel == "email", IngestionConnection.status == "active"))).scalars().first()
    if conn is None:
        raise NotFound("Email connection not found")
    if llm is None:
        llm = await get_household_llm_client(session, user.household_id)
    token = decrypt_string(conn.token_encrypted) or ""
    messages = await gateway.fetch_messages(token)
    docs = 0
    attachments_ingested = 0
    txns_created = 0
    for msg in messages:
        payload = EmailInboundIn(**msg)
        doc = await create_email_document(session, user, payload)
        docs += 1
        ingested = await _ingest_email_attachments(session, user, payload.attachments)
        attachments_ingested += ingested
        if ingested:
            continue  # attachments go through OCR -> their own txn; don't double-count
        parsed = await _parse_email(payload, llm, user, session)
        if not parsed or not parsed.is_transaction or not parsed.amount:
            continue
        amount = _money(parsed.amount)
        if parsed.type != "credit":  # money out -> negative (canonical)
            amount = -amount
        external_seed = payload.message_id or hashlib.sha256(f"{payload.from_address}{payload.subject}{payload.body}".encode()).hexdigest()[:24]
        needs_review = (parsed.confidence or 0) < 0.75
        await txn_service.create_transaction(session, user, TransactionCreate(
            merchant=parsed.merchant or payload.from_address,
            amount=amount,
            currency=_currency(parsed.currency),
            txn_date=_date(parsed.date or (payload.received_at.date() if payload.received_at else None)),
            status="draft",
            source_document_id=doc.id,
            source_channel="email",
            notes=(payload.subject or payload.body or "")[:500],
            confidence=parsed.confidence,
            external_id=f"email:{conn.id}:{external_seed}",
        ))
        txns_created += 1
        if needs_review:
            doc.status = "needs_review"
            await session.commit()
    return {"documents_created": docs, "attachments_ingested": attachments_ingested, "transactions_created": txns_created}
```

(Check `get_household_llm_client` import — `sms_webhook` at service.py:505 already imports it; reuse. Update the email-sync response schema in `ingestion/schemas.py` if it's typed.)

- [ ] **Step 4: Run tests**

Run: `cd backend && python -m pytest tests/test_m11_ingestion.py -v`
Expected: PASS — new test + existing email/attachment tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/ingestion/service.py backend/app/ingestion/schemas.py backend/app/ingestion/router.py backend/tests/test_m11_ingestion.py
git commit -m "feat(gmail): parse alert/receipt email bodies into draft transactions"
```

---

## Final verification

- [ ] `cd backend && python -m pytest tests/ -v` (or in the api container) — full suite green.
- [ ] `cd web && npx vitest run && npx tsc --noEmit` — full suite green.
- [ ] Manual smoke (sandbox creds): connect Link with `user_transactions_dynamic`, run a sync, confirm: picker shows only supported types; spend shows Plaid txns as spend (negative); a CC payment registers on the Debt page ledger; net worth moves.
