# Comprehensive Debt Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the debt page into a comprehensive loan-management surface with editable loans, rich loan cards, real payment logging, and a collapsed paginated payment history — where each logged payment fully recomputes the loan's remaining amortization schedule.

**Architecture:** A new `loan_payment` ledger stores real payments. `regenerate_schedule()` becomes payment-aware: it applies recorded payments in order (deriving each payment's interest/principal split and running balance), then projects the *remaining* schedule forward from the current balance. `LoanOut` gains derived totals so the UI can show outstanding balance and payoff progress. The frontend replaces the flat list with loan cards and restructures the detail sheet into history / upcoming / payoff / edit sections.

**Tech Stack:** FastAPI + SQLAlchemy (async) + Alembic + Pydantic (backend); Next.js App Router + React Query + openapi-typescript + Tailwind + vitest (frontend).

## Global Constraints

- Money values: `Numeric(18, 2)`, handled via `_money()` (quantize to `0.01`, `ROUND_HALF_UP`). Copy verbatim.
- Interest accrual uses **monthly periods** via `_monthly_rate(loan)` — one month's interest per payment/installment, consistent with the existing `_project()` engine. No day-by-day accrual.
- All loan/payment access is household-scoped through the existing `service.get_loan()` ownership check; mutating endpoints require `require_role("owner", "member")`.
- Backend tests run against Postgres at `TEST_DATABASE_URL` (default `postgresql+asyncpg://finance:finance@localhost:5433/finance`); they skip if unreachable. The new migration must be applied to that DB before running them (`alembic upgrade head`).
- Frontend types come from `@shared/api-schema`; regenerate with `npm run gen:api` (needs backend running on `:8000`) before consuming new schemas.
- Currency strings: `.upper()[:3]`.

---

## File Structure

**Backend**
- `backend/app/models/debt.py` — add `LoanPayment` model.
- `backend/migrations/versions/<new>_m19_loan_payments.py` — create `loan_payment` table.
- `backend/app/loans/schemas.py` — `LoanPaymentIn`, `LoanPaymentOut`, `LoanPaymentListOut`; extend `LoanOut`.
- `backend/app/loans/service.py` — payment-aware recompute (`_apply_payments`, `_project` kwargs, `_project_remaining` via `_project`), `record_payment`, `delete_payment`, `list_payments`, `_loan_out` derived fields.
- `backend/app/loans/router.py` — payment endpoints.
- `backend/tests/test_m8_loans.py` — recompute + payment tests.

**Frontend**
- `web/lib/api/loans.ts` — `usePatchLoan`, `useLoanPayments`, `useCreatePayment`, `useDeletePayment`.
- `web/components/debt/loan-form.tsx` — new shared form + `loanToFormDefaults` helper.
- `web/components/debt/loan-form.test.tsx` — vitest for `loanToFormDefaults`.
- `web/app/(app)/debt/page.tsx` — loan cards, edit/delete wiring.
- `web/components/debt/loan-detail.tsx` — restructured detail sheet.

---

## Task 1: `loan_payment` model + migration

**Files:**
- Modify: `backend/app/models/debt.py`
- Create: `backend/migrations/versions/a1b2c3d4e5f6_m19_loan_payments.py`

**Interfaces:**
- Produces: `LoanPayment` ORM model with columns `id, loan_id, payment_date, amount, interest_component, principal_component, balance_after, note, created_at`.

- [ ] **Step 1: Add the model**

Append to `backend/app/models/debt.py` (after `CreditCardDetail`). Note `func`/`DateTime` imports — add them to the existing `from sqlalchemy import ...` line (`DateTime`) and `from sqlalchemy import func` is available via `sqlalchemy`; extend the import to include `DateTime, func`:

```python
class LoanPayment(Base):
    """A real payment recorded against a Loan. Drives schedule recompute."""

    __tablename__ = "loan_payment"

    id: Mapped[uuid.UUID] = uuid_pk()
    loan_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("loan.id", ondelete="CASCADE"), index=True, nullable=False
    )
    payment_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = money(nullable=False)
    interest_component: Mapped[Decimal | None] = money(nullable=True)
    principal_component: Mapped[Decimal | None] = money(nullable=True)
    balance_after: Mapped[Decimal | None] = money(nullable=True)
    note: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
```

Update the imports at the top of the file:

```python
from datetime import date, datetime
from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, func
```

- [ ] **Step 2: Create the migration**

Create `backend/migrations/versions/a1b2c3d4e5f6_m19_loan_payments.py`:

```python
"""m19 loan payments ledger

Revision ID: a1b2c3d4e5f6
Revises: 6c31f8e2a9d4
Create Date: 2026-06-21
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "6c31f8e2a9d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "loan_payment",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("loan_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("payment_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("interest_component", sa.Numeric(18, 2), nullable=True),
        sa.Column("principal_component", sa.Numeric(18, 2), nullable=True),
        sa.Column("balance_after", sa.Numeric(18, 2), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["loan_id"],
            ["loan.id"],
            name=op.f("fk_loan_payment_loan_id_loan"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_loan_payment")),
    )
    op.create_index(op.f("ix_loan_payment_loan_id"), "loan_payment", ["loan_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_loan_payment_loan_id"), table_name="loan_payment")
    op.drop_table("loan_payment")
```

- [ ] **Step 3: Apply the migration**

Run (from `backend/`, with Postgres up on `:5433`):
```bash
cd backend && alembic upgrade head
```
Expected: `Running upgrade 6c31f8e2a9d4 -> a1b2c3d4e5f6, m19 loan payments ledger`.

- [ ] **Step 4: Verify the table exists**

Run:
```bash
psql postgresql://finance:finance@localhost:5433/finance -c "\d loan_payment"
```
Expected: table with the columns above and index `ix_loan_payment_loan_id`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/debt.py backend/migrations/versions/a1b2c3d4e5f6_m19_loan_payments.py
git commit -m "feat(debt): add loan_payment ledger model and migration"
```

---

## Task 2: Payment schemas + LoanOut derived fields

**Files:**
- Modify: `backend/app/loans/schemas.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `LoanPaymentIn(payment_date: date, amount: Decimal, note: str | None)`, `LoanPaymentOut`, `LoanPaymentListOut(items, total)`; `LoanOut` extended with `outstanding_balance, total_paid, total_principal_paid, total_interest_paid, progress_pct`.

- [ ] **Step 1: Add payment schemas**

Append to `backend/app/loans/schemas.py`:

```python
class LoanPaymentIn(BaseModel):
    payment_date: date
    amount: Decimal
    note: str | None = None


class LoanPaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    loan_id: uuid.UUID
    payment_date: date
    amount: Decimal
    interest_component: Decimal | None = None
    principal_component: Decimal | None = None
    balance_after: Decimal | None = None
    note: str | None = None


class LoanPaymentListOut(BaseModel):
    items: list[LoanPaymentOut]
    total: int
```

- [ ] **Step 2: Extend `LoanOut`**

Add these fields to the `LoanOut` class (after `base_min_or_emi_amount`):

```python
    outstanding_balance: Decimal | None = None
    total_paid: Decimal | None = None
    total_principal_paid: Decimal | None = None
    total_interest_paid: Decimal | None = None
    progress_pct: float | None = None
```

- [ ] **Step 3: Verify it imports**

Run:
```bash
cd backend && python -c "from app.loans.schemas import LoanPaymentIn, LoanPaymentOut, LoanPaymentListOut, LoanOut; print('ok')"
```
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/loans/schemas.py
git commit -m "feat(debt): add loan payment schemas and LoanOut derived fields"
```

---

## Task 3: Payment-aware recompute + payment service functions

**Files:**
- Modify: `backend/app/loans/service.py`
- Test: `backend/tests/test_m8_loans.py`

**Interfaces:**
- Consumes: `LoanPayment` (Task 1), `LoanPaymentIn` (Task 2).
- Produces:
  - `_apply_payments(loan, payments) -> tuple[Decimal, list[dict]]` — returns `(current_balance, applied)` where each `applied` dict has keys `payment, interest_component, principal_component, balance_after`.
  - `_project(...)` extended with keyword args `start_balance: Decimal | None = None, start: date | None = None, first_no: int = 1` (default behavior unchanged).
  - `record_payment(session, user, loan_id, data: LoanPaymentIn) -> dict` → a `LoanPaymentOut`-shaped dict.
  - `delete_payment(session, user, loan_id, payment_id) -> None`.
  - `list_payments(session, user, loan_id, limit: int, offset: int) -> dict` → `{"items": [...], "total": int}`.
  - `_loan_out` now returns the five derived fields from Task 2.

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_m8_loans.py`. Update the imports at the top:

```python
from app.loans.schemas import LoanIn, LoanPaymentIn, PayoffCalcIn, PayoffStrategyIn
from app.loans.service import (
    create_loan,
    delete_payment,
    list_payments,
    payoff_calc,
    payoff_strategy,
    record_payment,
    schedule,
)
from app.models.debt import Loan, LoanPayment, PaymentSchedule
```

Add the tests:

```python
async def _simple_loan(session, user):
    return await create_loan(
        session,
        user,
        LoanIn(
            name="Recompute Loan",
            type="personal",
            schedule_kind="amortizing",
            principal=Decimal("1000.00"),
            currency="USD",
            interest_rate=Decimal("12.00"),  # 1%/month
            compounding="monthly",
            min_or_emi_amount=Decimal("100.00"),
            due_day=1,
            start_date=date(2026, 1, 1),
        ),
    )


@pytest.mark.asyncio
async def test_record_payment_reduces_balance_and_splits(session):
    user = await _user(session)
    loan = await _simple_loan(session, user)
    out = await record_payment(
        session, user, loan["id"], LoanPaymentIn(payment_date=date(2026, 1, 1), amount=Decimal("100.00"))
    )
    # 1% of 1000 = 10 interest, 90 principal, balance 910
    assert out["interest_component"] == Decimal("10.00")
    assert out["principal_component"] == Decimal("90.00")
    assert out["balance_after"] == Decimal("910.00")


@pytest.mark.asyncio
async def test_loan_out_outstanding_and_progress(session):
    user = await _user(session)
    loan = await _simple_loan(session, user)
    await record_payment(
        session, user, loan["id"], LoanPaymentIn(payment_date=date(2026, 1, 1), amount=Decimal("100.00"))
    )
    loans = await __import__("app.loans.service", fromlist=["list_loans"]).list_loans(session, user)
    me = next(l for l in loans if l["id"] == loan["id"])
    assert me["outstanding_balance"] == Decimal("910.00")
    assert me["total_principal_paid"] == Decimal("90.00")
    assert me["total_interest_paid"] == Decimal("10.00")
    assert me["total_paid"] == Decimal("100.00")
    assert 8.5 < me["progress_pct"] < 9.5  # 90/1000 = 9%


@pytest.mark.asyncio
async def test_schedule_recomputes_from_current_balance(session):
    user = await _user(session)
    loan = await _simple_loan(session, user)
    before = await schedule(session, user, loan["id"])
    assert before[0].balance_after == Decimal("910.00")  # first projected installment from full principal
    await record_payment(
        session, user, loan["id"], LoanPaymentIn(payment_date=date(2026, 1, 1), amount=Decimal("100.00"))
    )
    after = await schedule(session, user, loan["id"])
    # first future installment now starts from 910 balance: interest 9.10, principal 90.90 -> 819.10
    assert after[0].balance_after == Decimal("819.10")
    assert after[0].installment_no == 2  # numbered after the one recorded payment


@pytest.mark.asyncio
async def test_delete_payment_restores_projection(session):
    user = await _user(session)
    loan = await _simple_loan(session, user)
    p = await record_payment(
        session, user, loan["id"], LoanPaymentIn(payment_date=date(2026, 1, 1), amount=Decimal("100.00"))
    )
    await delete_payment(session, user, loan["id"], p["id"])
    after = await schedule(session, user, loan["id"])
    assert after[0].balance_after == Decimal("910.00")
    assert after[0].installment_no == 1


@pytest.mark.asyncio
async def test_list_payments_pagination(session):
    user = await _user(session)
    loan = await _simple_loan(session, user)
    for i in range(3):
        await record_payment(
            session, user, loan["id"], LoanPaymentIn(payment_date=date(2026, 1, 1), amount=Decimal("100.00"))
        )
    page = await list_payments(session, user, loan["id"], limit=2, offset=0)
    assert page["total"] == 3
    assert len(page["items"]) == 2


@pytest.mark.asyncio
async def test_payment_household_scoped(session):
    user = await _user(session)
    other = await _user(session)
    loan = await _simple_loan(session, user)
    with pytest.raises(Exception):
        await record_payment(
            session, other, loan["id"], LoanPaymentIn(payment_date=date(2026, 1, 1), amount=Decimal("50.00"))
        )
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd backend && pytest tests/test_m8_loans.py -k "record_payment or outstanding or recomputes or delete_payment or list_payments or household_scoped" -v
```
Expected: FAIL — `record_payment`/`delete_payment`/`list_payments` don't exist (ImportError).

- [ ] **Step 3: Add imports + `_apply_payments` to service**

In `backend/app/loans/service.py`, update the model import:

```python
from app.models.debt import Loan, LoanPayment, PaymentSchedule
```

Add `_apply_payments` (place it above `regenerate_schedule`):

```python
def _apply_payments(loan: Loan, payments: list[LoanPayment]) -> tuple[Decimal, list[dict]]:
    """Apply recorded payments in order; accrue one month's interest per payment.

    Returns (current_balance, applied) where each applied dict carries the
    payment row plus its computed interest/principal split and balance_after.
    """
    balance = _money(loan.principal)
    rate = _monthly_rate(loan)
    applied: list[dict] = []
    for payment in payments:
        amount = _money(payment.amount)
        interest = _money(balance * rate)
        interest_charged = min(interest, amount)
        principal_paid = min(balance, _money(amount - interest_charged))
        balance = _money(balance - principal_paid)
        applied.append(
            {
                "payment": payment,
                "interest_component": interest_charged,
                "principal_component": principal_paid,
                "balance_after": balance,
            }
        )
        if balance <= 0:
            break
    return balance, applied
```

- [ ] **Step 4: Generalize `_project` (behavior-preserving)**

Replace the `_project` function body with the keyword-arg version (defaults reproduce current behavior exactly):

```python
def _project(
    loan: Loan,
    monthly_payment: Decimal,
    extra_payments: list[tuple[date, Decimal]],
    *,
    start_balance: Decimal | None = None,
    start: date | None = None,
    first_no: int = 1,
) -> list[dict]:
    balance = _money(loan.principal if start_balance is None else start_balance)
    payment = _money(monthly_payment)
    rate = _monthly_rate(loan)
    start = start or loan.start_date or date.today()
    due_day = loan.due_day or start.day
    extras = defaultdict_money(extra_payments)
    rows = []
    for offset in range(0, 600):
        idx = first_no + offset
        due_date = _add_months(start, offset, due_day)
        interest = _money(balance * rate)
        scheduled = payment + extras.get((due_date.year, due_date.month), Decimal("0.00"))
        if scheduled <= interest and balance > 0:
            principal_component = Decimal("0.00")
        else:
            principal_component = min(balance, _money(scheduled - interest))
        actual_payment = _money(principal_component + interest)
        balance = _money(balance - principal_component)
        rows.append(
            {
                "installment_no": idx,
                "due_date": due_date,
                "payment": actual_payment,
                "principal_component": principal_component,
                "interest_component": interest,
                "balance_after": balance,
            }
        )
        if balance <= 0:
            break
        if loan.end_date and due_date >= loan.end_date and loan.min_or_emi_amount is None:
            break
    return rows
```

- [ ] **Step 5: Make `regenerate_schedule` payment-aware**

Replace `regenerate_schedule` with:

```python
async def regenerate_schedule(session: AsyncSession, user: User, loan: Loan) -> None:
    await session.execute(delete(PaymentSchedule).where(PaymentSchedule.loan_id == loan.id))
    payments = list(
        (
            await session.execute(
                select(LoanPayment)
                .where(LoanPayment.loan_id == loan.id)
                .order_by(LoanPayment.payment_date, LoanPayment.created_at)
            )
        ).scalars().all()
    )
    balance, applied = _apply_payments(loan, payments)
    for row in applied:
        payment = row["payment"]
        payment.interest_component = row["interest_component"]
        payment.principal_component = row["principal_component"]
        payment.balance_after = row["balance_after"]

    if loan.schedule_kind == "revolving" or balance <= 0:
        anchor = payments[-1].payment_date if payments else (loan.start_date or date.today())
        await _ensure_due_notification(session, user, loan, anchor)
        return

    if payments:
        anchor = _add_months(payments[-1].payment_date, 1, loan.due_day)
    else:
        anchor = loan.start_date or date.today()
    projection = _project(
        loan,
        loan.min_or_emi_amount or _calculated_payment(loan),
        [],
        start_balance=balance,
        start=anchor,
        first_no=len(payments) + 1,
    )
    for point in projection[:600]:
        session.add(
            PaymentSchedule(
                loan_id=loan.id,
                installment_no=point["installment_no"],
                due_date=point["due_date"],
                principal_component=point["principal_component"],
                interest_component=point["interest_component"],
                balance_after=point["balance_after"],
                status="due",
            )
        )
    await _ensure_due_notification(
        session,
        user,
        loan,
        projection[0]["due_date"] if projection else anchor,
    )
```

Note: when there are no payments, `anchor = loan.start_date`, `first_no = 1`, `start_balance = principal` → identical to the previous projection. Existing tests stay green.

- [ ] **Step 6: Add `record_payment`, `delete_payment`, `list_payments`**

Add to `backend/app/loans/service.py` (after `delete_loan`):

```python
async def record_payment(
    session: AsyncSession, user: User, loan_id: uuid.UUID, data: LoanPaymentIn
) -> dict:
    loan = await get_loan(session, user, loan_id)
    payment = LoanPayment(
        loan_id=loan.id,
        payment_date=data.payment_date,
        amount=_money(data.amount),
        note=(data.note or None),
    )
    session.add(payment)
    await session.flush()
    await regenerate_schedule(session, user, loan)
    await session.commit()
    await session.refresh(payment)
    return _payment_out(payment)


async def delete_payment(
    session: AsyncSession, user: User, loan_id: uuid.UUID, payment_id: uuid.UUID
) -> None:
    loan = await get_loan(session, user, loan_id)
    payment = (
        await session.execute(
            select(LoanPayment).where(
                LoanPayment.id == payment_id, LoanPayment.loan_id == loan.id
            )
        )
    ).scalar_one_or_none()
    if payment is None:
        raise NotFound("Payment not found")
    await session.delete(payment)
    await session.flush()
    await regenerate_schedule(session, user, loan)
    await session.commit()


async def list_payments(
    session: AsyncSession, user: User, loan_id: uuid.UUID, limit: int, offset: int
) -> dict:
    await get_loan(session, user, loan_id)
    total = (
        await session.execute(
            select(func.count()).select_from(LoanPayment).where(LoanPayment.loan_id == loan_id)
        )
    ).scalar_one()
    rows = (
        await session.execute(
            select(LoanPayment)
            .where(LoanPayment.loan_id == loan_id)
            .order_by(LoanPayment.payment_date.desc(), LoanPayment.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    return {"items": [_payment_out(r) for r in rows], "total": int(total)}


def _payment_out(payment: LoanPayment) -> dict:
    return {
        "id": payment.id,
        "loan_id": payment.loan_id,
        "payment_date": payment.payment_date,
        "amount": _money(payment.amount),
        "interest_component": payment.interest_component,
        "principal_component": payment.principal_component,
        "balance_after": payment.balance_after,
        "note": payment.note,
    }
```

Add `func` to the SQLAlchemy import at the top of the file:

```python
from sqlalchemy import delete, func, select
```

- [ ] **Step 7: Add derived fields to `_loan_out`**

In `_loan_out`, before the `return` dict, compute totals:

```python
    payments = (
        await session.execute(select(LoanPayment).where(LoanPayment.loan_id == loan.id))
    ).scalars().all()
    total_paid = _money(sum((_money(p.amount) for p in payments), Decimal("0.00")))
    total_principal_paid = _money(
        sum((_money(p.principal_component) for p in payments), Decimal("0.00"))
    )
    total_interest_paid = _money(
        sum((_money(p.interest_component) for p in payments), Decimal("0.00"))
    )
    principal = _money(loan.principal)
    outstanding = _money(max(Decimal("0.00"), principal - total_principal_paid))
    progress_pct = (
        float((total_principal_paid / principal * Decimal("100")).quantize(Decimal("0.01")))
        if principal > 0
        else 0.0
    )
    progress_pct = max(0.0, min(100.0, progress_pct))
```

Add these keys to the returned dict (alongside the existing ones):

```python
        "outstanding_balance": outstanding,
        "total_paid": total_paid,
        "total_principal_paid": total_principal_paid,
        "total_interest_paid": total_interest_paid,
        "progress_pct": progress_pct,
```

Add the `LoanPaymentIn` import to the schemas import line at the top:

```python
from app.loans.schemas import LoanIn, LoanPatch, LoanPaymentIn, PayoffCalcIn, PayoffStrategyIn
```

- [ ] **Step 8: Run new tests**

Run:
```bash
cd backend && pytest tests/test_m8_loans.py -k "record_payment or outstanding or recomputes or delete_payment or list_payments or household_scoped" -v
```
Expected: all PASS.

- [ ] **Step 9: Run the full loans suite (regression guard)**

Run:
```bash
cd backend && pytest tests/test_m8_loans.py -v
```
Expected: all PASS, including the pre-existing `test_emi_schedule_payoff_strategy_and_due_reminder` (proves the `_project` refactor is behavior-preserving).

- [ ] **Step 10: Commit**

```bash
git add backend/app/loans/service.py backend/tests/test_m8_loans.py
git commit -m "feat(debt): payment-aware schedule recompute and payment service"
```

---

## Task 4: Payment endpoints + regenerate API schema

**Files:**
- Modify: `backend/app/loans/router.py`
- Modify: `shared/api-schema.ts` (generated)

**Interfaces:**
- Consumes: `record_payment`, `delete_payment`, `list_payments` (Task 3); `LoanPaymentIn`, `LoanPaymentOut`, `LoanPaymentListOut` (Task 2).
- Produces: HTTP routes `GET/POST /loans/{loan_id}/payments`, `DELETE /loans/{loan_id}/payments/{payment_id}`; new TS schema types `LoanPaymentIn`, `LoanPaymentOut`, `LoanPaymentListOut`.

- [ ] **Step 1: Add endpoints to router**

Update the schema import in `backend/app/loans/router.py`:

```python
from app.loans.schemas import (
    LoanIn,
    LoanOut,
    LoanPatch,
    LoanPaymentIn,
    LoanPaymentListOut,
    LoanPaymentOut,
    PaymentScheduleOut,
    PayoffCalcIn,
    PayoffCalcOut,
    PayoffStrategyIn,
    PayoffStrategyOut,
)
```

Add the routes (after `loan_schedule`):

```python
@router.get("/loans/{loan_id}/payments", response_model=LoanPaymentListOut)
async def list_loan_payments(
    loan_id: uuid.UUID,
    limit: int = 12,
    offset: int = 0,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LoanPaymentListOut:
    try:
        return await service.list_payments(session, user, loan_id, limit=limit, offset=offset)
    except service.NotFound as exc:
        _not_found(exc)


@router.post(
    "/loans/{loan_id}/payments",
    response_model=LoanPaymentOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_loan_payment(
    loan_id: uuid.UUID,
    data: LoanPaymentIn,
    user: User = Depends(require_role("owner", "member")),
    session: AsyncSession = Depends(get_session),
) -> LoanPaymentOut:
    try:
        return await service.record_payment(session, user, loan_id, data)
    except service.NotFound as exc:
        _not_found(exc)


@router.delete(
    "/loans/{loan_id}/payments/{payment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_loan_payment(
    loan_id: uuid.UUID,
    payment_id: uuid.UUID,
    user: User = Depends(require_role("owner", "member")),
    session: AsyncSession = Depends(get_session),
):
    try:
        await service.delete_payment(session, user, loan_id, payment_id)
    except service.NotFound as exc:
        _not_found(exc)
```

- [ ] **Step 2: Start the backend**

Run (background, from `backend/`):
```bash
cd backend && uvicorn app.main:app --port 8000 &
```
Wait until `curl -s http://localhost:8000/openapi.json | head -c 50` returns JSON.

- [ ] **Step 3: Smoke-test the new route shows in the schema**

Run:
```bash
curl -s http://localhost:8000/openapi.json | python -c "import sys, json; p=json.load(sys.stdin)['paths']; print([k for k in p if 'payments' in k])"
```
Expected: `['/loans/{loan_id}/payments', '/loans/{loan_id}/payments/{payment_id}']`.

- [ ] **Step 4: Regenerate the frontend API schema**

Run (from `web/`):
```bash
cd web && npm run gen:api
```
Then verify:
```bash
grep -c "LoanPaymentOut" ../shared/api-schema.ts
```
Expected: ≥ 1.

- [ ] **Step 5: Commit**

```bash
git add backend/app/loans/router.py shared/api-schema.ts
git commit -m "feat(debt): loan payment endpoints and regenerated api schema"
```

---

## Task 5: Frontend API hooks

**Files:**
- Modify: `web/lib/api/loans.ts`

**Interfaces:**
- Consumes: generated types from `@shared/api-schema` (Task 4).
- Produces: `usePatchLoan()`, `useLoanPayments(loanId, { limit, offset })`, `useCreatePayment()`, `useDeletePayment()`; types `LoanPayment`, `LoanPaymentIn`, `LoanPaymentList`.

- [ ] **Step 1: Add types and hooks**

Add type aliases near the existing ones in `web/lib/api/loans.ts`:

```typescript
export type LoanPayment = components["schemas"]["LoanPaymentOut"];
export type LoanPaymentIn = components["schemas"]["LoanPaymentIn"];
export type LoanPaymentList = components["schemas"]["LoanPaymentListOut"];
```

Add hooks at the end of the file:

```typescript
export function usePatchLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: LoanPatch }) =>
      unwrap(api.PATCH("/loans/{loan_id}", { params: { path: { loan_id: id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useLoanPayments(
  loanId: string | null,
  opts: { limit: number; offset: number },
) {
  return useQuery<LoanPaymentList>({
    queryKey: ["loans", "payments", loanId, opts.limit, opts.offset],
    enabled: Boolean(loanId),
    queryFn: () =>
      unwrap(
        api.GET("/loans/{loan_id}/payments", {
          params: {
            path: { loan_id: loanId as string },
            query: { limit: opts.limit, offset: opts.offset },
          },
        }),
      ),
  });
}

function invalidateLoan(qc: ReturnType<typeof useQueryClient>, loanId: string) {
  qc.invalidateQueries({ queryKey: KEY });
  qc.invalidateQueries({ queryKey: ["loans", "schedule", loanId] });
  qc.invalidateQueries({ queryKey: ["loans", "payments", loanId] });
}

export function useCreatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: LoanPaymentIn }) =>
      unwrap(
        api.POST("/loans/{loan_id}/payments", { params: { path: { loan_id: id } }, body }),
      ),
    onSuccess: (_d, vars) => invalidateLoan(qc, vars.id),
  });
}

export function useDeletePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, paymentId }: { id: string; paymentId: string }) => {
      const { error } = await api.DELETE("/loans/{loan_id}/payments/{payment_id}", {
        params: { path: { loan_id: id, payment_id: paymentId } },
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => invalidateLoan(qc, vars.id),
  });
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
cd web && npm run typecheck
```
Expected: no errors. (If `query` keys are flagged, confirm the path params match the regenerated schema names exactly.)

- [ ] **Step 3: Commit**

```bash
git add web/lib/api/loans.ts
git commit -m "feat(debt): react-query hooks for loan patch and payments"
```

---

## Task 6: Shared LoanForm + Edit wiring

**Files:**
- Create: `web/components/debt/loan-form.tsx`
- Create: `web/components/debt/loan-form.test.tsx`

**Interfaces:**
- Consumes: `Loan`, `LoanIn` (`@/lib/api/loans`).
- Produces:
  - `loanToFormDefaults(loan?: Loan) -> Record<string, string>` — pure helper mapping a loan (or undefined) to string form defaults.
  - `formToLoanIn(form: FormData) -> LoanIn` — pure helper building the payload.
  - `<LoanForm loan? onSubmit pending submitLabel />` — renders the field set and calls `onSubmit(payload)`.

- [ ] **Step 1: Write failing test for `loanToFormDefaults`**

Create `web/components/debt/loan-form.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { loanToFormDefaults } from "./loan-form";
import type { Loan } from "@/lib/api/loans";

const loan = {
  id: "1",
  name: "Car",
  type: "auto",
  schedule_kind: "amortizing",
  principal: "10000",
  currency: "USD",
  interest_rate: "5",
  min_or_emi_amount: "300",
  due_day: 15,
  start_date: "2026-01-01",
} as Loan;

describe("loanToFormDefaults", () => {
  it("maps a loan to string defaults for editing", () => {
    const d = loanToFormDefaults(loan);
    expect(d.name).toBe("Car");
    expect(d.principal).toBe("10000");
    expect(d.interest_rate).toBe("5");
    expect(d.due_day).toBe("15");
    expect(d.start_date).toBe("2026-01-01");
  });

  it("returns empty/sensible defaults when no loan given", () => {
    const d = loanToFormDefaults();
    expect(d.name).toBe("");
    expect(d.type).toBe("other");
    expect(d.currency).toBe("USD");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd web && npm run test:unit -- loan-form
```
Expected: FAIL — cannot resolve `./loan-form`.

- [ ] **Step 3: Implement `loan-form.tsx`**

Create `web/components/debt/loan-form.tsx`:

```tsx
"use client";

import type { Loan, LoanIn } from "@/lib/api/loans";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function loanToFormDefaults(loan?: Loan): Record<string, string> {
  return {
    name: loan?.name ?? "",
    type: loan?.type ?? "other",
    schedule_kind: loan?.schedule_kind ?? "amortizing",
    principal: loan?.principal != null ? String(loan.principal) : "",
    currency: loan?.currency ?? "USD",
    interest_rate: loan?.interest_rate != null ? String(loan.interest_rate) : "",
    min_or_emi_amount:
      loan?.min_or_emi_amount != null ? String(loan.min_or_emi_amount) : "",
    due_day: loan?.due_day != null ? String(loan.due_day) : "",
    start_date: loan?.start_date ?? "",
  };
}

export function formToLoanIn(form: FormData): LoanIn {
  const str = (k: string) => {
    const v = String(form.get(k) ?? "").trim();
    return v || null;
  };
  return {
    name: String(form.get("name") ?? ""),
    type: String(form.get("type") ?? "other"),
    schedule_kind: String(form.get("schedule_kind") ?? "amortizing"),
    principal: String(form.get("principal") ?? "0"),
    currency: String(form.get("currency") ?? "USD"),
    interest_rate: str("interest_rate"),
    compounding: "monthly",
    min_or_emi_amount: str("min_or_emi_amount"),
    due_day: form.get("due_day") ? Number(form.get("due_day")) : null,
    start_date: str("start_date"),
  } as LoanIn;
}

export function LoanForm({
  loan,
  onSubmit,
  pending,
  submitLabel,
}: {
  loan?: Loan;
  onSubmit: (payload: LoanIn) => void;
  pending: boolean;
  submitLabel: string;
}) {
  const d = loanToFormDefaults(loan);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(formToLoanIn(new FormData(e.currentTarget)));
      }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={d.name} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="type">Type</Label>
          <select id="type" name="type" className={SELECT_CLASS} defaultValue={d.type}>
            <option value="home">Mortgage / Home</option>
            <option value="auto">Auto</option>
            <option value="education">Student</option>
            <option value="personal">Personal</option>
            <option value="credit_card">Credit card</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="schedule_kind">Schedule</Label>
          <select
            id="schedule_kind"
            name="schedule_kind"
            className={SELECT_CLASS}
            defaultValue={d.schedule_kind}
          >
            <option value="amortizing">Amortizing</option>
            <option value="emi">EMI</option>
            <option value="revolving">Revolving</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="principal">Principal</Label>
          <Input id="principal" name="principal" type="number" min="0" step="0.01" defaultValue={d.principal} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="currency">Currency</Label>
          <Input id="currency" name="currency" defaultValue={d.currency} maxLength={3} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="interest_rate">Interest rate %</Label>
          <Input id="interest_rate" name="interest_rate" type="number" min="0" step="0.01" defaultValue={d.interest_rate} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="min_or_emi_amount">Min / EMI payment</Label>
          <Input id="min_or_emi_amount" name="min_or_emi_amount" type="number" min="0" step="0.01" defaultValue={d.min_or_emi_amount} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="due_day">Due day (1-31)</Label>
          <Input id="due_day" name="due_day" type="number" min="1" max="31" defaultValue={d.due_day} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="start_date">Start date</Label>
          <Input id="start_date" name="start_date" type="date" defaultValue={d.start_date} />
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd web && npm run test:unit -- loan-form
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/debt/loan-form.tsx web/components/debt/loan-form.test.tsx
git commit -m "feat(debt): shared LoanForm with pure mapping helpers"
```

---

## Task 7: Main debt page — loan cards + edit/delete wiring

**Files:**
- Modify: `web/app/(app)/debt/page.tsx`

**Interfaces:**
- Consumes: `useLoans`, `useCreateLoan`, `usePatchLoan`, `useDeleteLoan`, `usePayoffStrategy`, `Loan` (`@/lib/api/loans`); `LoanForm`, `formToLoanIn` (Task 6); `LoanDetail` (Task 8).
- Produces: rebuilt `DebtPage` rendering `LoanCard` grid + summary using `outstanding_balance`; `NewLoanDialog` now uses `LoanForm`.

- [ ] **Step 1: Rewrite `page.tsx`**

Replace the entire file `web/app/(app)/debt/page.tsx` with:

```tsx
"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  useCreateLoan,
  useLoans,
  usePayoffStrategy,
  type Loan,
} from "@/lib/api/loans";
import { formatCurrency } from "@/lib/format";
import { Landmark } from "@/lib/icons";
import { LoanDetail } from "@/components/debt/loan-detail";
import { LoanForm } from "@/components/debt/loan-form";
import { SectionIntro } from "@/components/insights/section-intro";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SegmentedPills } from "@/components/ui/segmented-pills";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const num = (v: unknown) => Number(v ?? 0);

const TYPE_LABEL: Record<string, string> = {
  home: "Mortgage",
  auto: "Auto",
  education: "Student",
  personal: "Personal",
  credit_card: "Credit card",
  other: "Other",
};

export default function DebtPage() {
  const loans = useLoans();
  const [selected, setSelected] = useState<Loan | null>(null);

  const totalOutstanding = useMemo(
    () =>
      (loans.data ?? []).reduce(
        (a, l) => a + num(l.outstanding_balance ?? l.principal),
        0,
      ),
    [loans.data],
  );
  const totalMonthly = useMemo(
    () => (loans.data ?? []).reduce((a, l) => a + num(l.min_or_emi_amount), 0),
    [loans.data],
  );

  return (
    <div className="space-y-4">
      <SectionIntro title="Debt" blurb="Balances, payoff timelines, and what extra payments would do." />
      <div className="flex justify-end">
        <NewLoanDialog />
      </div>

      {loans.isError ? (
        <div className="rounded-card-sm border border-border bg-card p-6 text-sm text-destructive shadow-card">
          Couldn&apos;t load loans. Check your connection and try again.
        </div>
      ) : loans.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : (loans.data ?? []).length === 0 ? (
        <div className="rounded-card-sm border border-border bg-card py-16 text-center text-sm text-muted shadow-card">
          No loans yet. Add one to see schedules and payoff plans.
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-card-sm border border-border bg-card p-5 shadow-card">
              <p className="text-sm text-muted">Total outstanding</p>
              <p data-numeric className="mt-1 text-2xl font-extrabold tracking-tight">
                {formatCurrency(totalOutstanding)}
              </p>
            </div>
            <div className="rounded-card-sm border border-border bg-card p-5 shadow-card">
              <p className="text-sm text-muted">Total monthly</p>
              <p data-numeric className="mt-1 text-2xl font-extrabold tracking-tight">
                {formatCurrency(totalMonthly)}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(loans.data ?? []).map((l) => (
              <LoanCard key={l.id} loan={l} onClick={() => setSelected(l)} />
            ))}
          </div>

          <PayoffStrategyCard />
        </>
      )}

      {selected && (
        <LoanDetail
          loan={selected}
          open={Boolean(selected)}
          onOpenChange={(v) => !v && setSelected(null)}
        />
      )}
    </div>
  );
}

function LoanCard({ loan, onClick }: { loan: Loan; onClick: () => void }) {
  const principal = num(loan.principal);
  const outstanding = num(loan.outstanding_balance ?? loan.principal);
  const progress = Math.max(0, Math.min(100, num(loan.progress_pct)));
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-card-sm border border-border bg-card p-5 text-left shadow-card transition-colors hover:border-accent/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <Landmark className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-bold tracking-tight">{loan.name}</p>
            <p className="text-xs text-muted">{TYPE_LABEL[loan.type] ?? loan.type}</p>
          </div>
        </div>
        {loan.interest_rate != null && (
          <Badge variant="secondary">{Number(loan.interest_rate)}% APR</Badge>
        )}
      </div>

      <p data-numeric className="mt-4 text-2xl font-extrabold tracking-tight">
        {formatCurrency(outstanding, { currency: loan.currency })}
      </p>
      <p className="text-xs text-muted">
        of {formatCurrency(principal, { currency: loan.currency })} principal
      </p>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-chip">
        <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span>
          {loan.min_or_emi_amount != null
            ? `${formatCurrency(loan.min_or_emi_amount, { currency: loan.currency })}/mo`
            : "—"}
        </span>
        <span>{loan.next_due_date ? `Due ${loan.next_due_date}` : ""}</span>
      </div>

      {loan.penalty_warning && (
        <Badge variant="warning" className="mt-3">
          {loan.penalty_warning}
        </Badge>
      )}
    </button>
  );
}

function PayoffStrategyCard() {
  const [strategy, setStrategy] = useState("snowball");
  const [extra, setExtra] = useState("0");
  const run = usePayoffStrategy();

  return (
    <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="mb-3">
        <h3 className="text-base font-bold capitalize tracking-tight">Payoff strategy</h3>
        <p className="text-xs text-muted">
          Order your debts for the fastest payoff. Snowball clears smallest balances first;
          avalanche targets the highest interest first.
        </p>
      </div>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <SegmentedPills
            options={[{ label: "Snowball", value: "snowball" }, { label: "Avalanche", value: "avalanche" }]}
            value={strategy}
            onChange={setStrategy}
          />
          <div className="space-y-1">
            <Label htmlFor="extra">Extra monthly payment</Label>
            <Input
              id="extra"
              type="number"
              min="0"
              step="0.01"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              className="w-40"
            />
          </div>
          <Button
            onClick={() => run.mutate({ strategy, extra_monthly_payment: extra || "0" })}
            disabled={run.isPending}
          >
            {run.isPending ? "Planning..." : "Plan payoff"}
          </Button>
        </div>

        {run.isError && <p className="text-sm text-destructive">Couldn&apos;t build a strategy.</p>}
        {run.data && (
          <ol className="space-y-2">
            {run.data.ordered_plan.map((p) => (
              <li key={p.loan_id} className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                  {p.order}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium capitalize">{p.name}</span>
                    <span data-numeric className="font-medium">{formatCurrency(p.principal)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{p.rationale}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function NewLoanDialog() {
  const [open, setOpen] = useState(false);
  const create = useCreateLoan();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add loan</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add loan</DialogTitle>
        </DialogHeader>
        <LoanForm
          pending={create.isPending}
          submitLabel="Add loan"
          onSubmit={async (payload) => {
            try {
              await create.mutateAsync(payload);
              toast.success("Loan added");
              setOpen(false);
            } catch {
              toast.error("Couldn't add loan");
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
cd web && npm run typecheck && npm run lint
```
Expected: no errors. (If `bg-chip`/`bg-accent-soft`/`bg-accent` classes are flagged unknown, confirm they exist in `globals.css`/`tailwind.config.ts` — they're already used by `debt-widget.tsx` and `page.tsx`, so they exist.)

- [ ] **Step 3: Commit**

```bash
git add "web/app/(app)/debt/page.tsx"
git commit -m "feat(debt): loan cards with outstanding balance and progress"
```

---

## Task 8: Loan detail — payment history, log payment, edit, delete

**Files:**
- Modify: `web/components/debt/loan-detail.tsx`

**Interfaces:**
- Consumes: `useLoanSchedule`, `usePayoffCalc`, `useLoanPayments`, `useCreatePayment`, `useDeletePayment`, `usePatchLoan`, `useDeleteLoan`, `Loan` (`@/lib/api/loans`); `LoanForm` (Task 6).
- Produces: restructured `LoanDetail` sheet.

- [ ] **Step 1: Rewrite `loan-detail.tsx`**

Replace the entire file `web/components/debt/loan-detail.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  useCreatePayment,
  useDeleteLoan,
  useDeletePayment,
  useLoanPayments,
  useLoanSchedule,
  usePatchLoan,
  usePayoffCalc,
  type Loan,
} from "@/lib/api/loans";
import { formatCurrency } from "@/lib/format";
import { LoanForm } from "@/components/debt/loan-form";
import { Button } from "@/components/ui/button";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE = 12;
const num = (v: unknown) => Number(v ?? 0);

export function LoanDetail({
  loan,
  open,
  onOpenChange,
}: {
  loan: Loan;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title={loan.name}>
      {editing ? (
        <EditSection loan={loan} onDone={() => setEditing(false)} onDeleted={() => onOpenChange(false)} />
      ) : (
        <div className="space-y-6">
          <HeaderStats loan={loan} onEdit={() => setEditing(true)} />
          <PaymentHistory loan={loan} />
          <UpcomingSchedule loan={loan} open={open} />
          <PayoffCalculator loan={loan} />
        </div>
      )}
    </ResponsiveSheet>
  );
}

function HeaderStats({ loan, onEdit }: { loan: Loan; onEdit: () => void }) {
  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Metric label="Outstanding" value={formatCurrency(loan.outstanding_balance ?? loan.principal, { currency: loan.currency })} />
        <Metric label="Paid to date" value={formatCurrency(loan.total_paid ?? 0, { currency: loan.currency })} />
        <Metric label="Interest paid" value={formatCurrency(loan.total_interest_paid ?? 0, { currency: loan.currency })} />
        <Metric label="Next due" value={loan.next_due_date ?? "—"} />
      </div>
      <Button variant="outline" onClick={onEdit}>Edit loan</Button>
    </section>
  );
}

function PaymentHistory({ loan }: { loan: Loan }) {
  const [offset, setOffset] = useState(0);
  const payments = useLoanPayments(loan.id, { limit: PAGE, offset });
  const create = useCreatePayment();
  const del = useDeletePayment();
  const total = payments.data?.total ?? 0;
  const items = payments.data?.items ?? [];

  async function onLog(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await create.mutateAsync({
        id: loan.id,
        body: {
          payment_date: String(form.get("payment_date") ?? ""),
          amount: String(form.get("amount") ?? "0"),
          note: String(form.get("note") ?? "").trim() || null,
        },
      });
      setOffset(0);
      toast.success("Payment logged");
      e.currentTarget.reset();
    } catch {
      toast.error("Couldn't log payment");
    }
  }

  return (
    <details className="group rounded-lg border border-border" >
      <summary className="cursor-pointer list-none p-3 text-sm font-semibold">
        Payment history{total ? ` (${total})` : ""}
        <span className="ml-1 text-xs font-normal text-muted group-open:hidden">— tap to expand</span>
      </summary>
      <div className="space-y-4 border-t border-border p-3">
        <form onSubmit={onLog} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="payment_date">Date</Label>
            <Input id="payment_date" name="payment_date" type="date" required className="w-40" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="amount">Amount</Label>
            <Input id="amount" name="amount" type="number" min="0" step="0.01" required className="w-32" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="note">Note</Label>
            <Input id="note" name="note" className="w-40" />
          </div>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Logging..." : "Log payment"}
          </Button>
        </form>

        {payments.isLoading ? (
          <Skeleton className="h-32" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">No payments recorded yet.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Principal</TableHead>
                  <TableHead className="text-right">Interest</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.payment_date}</TableCell>
                    <TableCell data-numeric className="text-right">{formatCurrency(p.amount, { currency: loan.currency })}</TableCell>
                    <TableCell data-numeric className="text-right">{formatCurrency(p.principal_component ?? 0, { currency: loan.currency })}</TableCell>
                    <TableCell data-numeric className="text-right">{formatCurrency(p.interest_component ?? 0, { currency: loan.currency })}</TableCell>
                    <TableCell data-numeric className="text-right">{formatCurrency(p.balance_after ?? 0, { currency: loan.currency })}</TableCell>
                    <TableCell className="text-right">
                      <button
                        type="button"
                        className="text-xs text-destructive hover:underline disabled:opacity-50"
                        disabled={del.isPending}
                        onClick={() => del.mutate({ id: loan.id, paymentId: p.id })}
                      >
                        Delete
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {total > PAGE && (
              <div className="flex items-center justify-between text-sm">
                <Button variant="outline" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE))}>
                  Previous
                </Button>
                <span className="text-muted">
                  {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
                </span>
                <Button variant="outline" disabled={offset + PAGE >= total} onClick={() => setOffset((o) => o + PAGE)}>
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}

function UpcomingSchedule({ loan, open }: { loan: Loan; open: boolean }) {
  const schedule = useLoanSchedule(open ? loan.id : null);
  const [limit, setLimit] = useState(PAGE);
  const rows = schedule.data ?? [];
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Upcoming schedule</h3>
      {schedule.isLoading ? (
        <Skeleton className="h-48" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">No upcoming installments — loan is paid off.</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Principal</TableHead>
                <TableHead className="text-right">Interest</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, limit).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.installment_no}</TableCell>
                  <TableCell>{r.due_date}</TableCell>
                  <TableCell data-numeric className="text-right">{formatCurrency(r.principal_component, { currency: loan.currency })}</TableCell>
                  <TableCell data-numeric className="text-right">{formatCurrency(r.interest_component, { currency: loan.currency })}</TableCell>
                  <TableCell data-numeric className="text-right">{formatCurrency(r.balance_after, { currency: loan.currency })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows.length > limit && (
            <Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>
              Show more
            </Button>
          )}
        </>
      )}
    </section>
  );
}

function PayoffCalculator({ loan }: { loan: Loan }) {
  const calc = usePayoffCalc();
  async function onCalc(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    calc.mutate({ id: loan.id, body: { monthly_payment: String(form.get("monthly_payment") ?? "0") } });
  }
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Payoff calculator</h3>
      <form onSubmit={onCalc} className="flex items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="monthly_payment">Monthly payment</Label>
          <Input id="monthly_payment" name="monthly_payment" type="number" min="0" step="0.01" required className="w-40" />
        </div>
        <Button type="submit" disabled={calc.isPending}>
          {calc.isPending ? "Calculating..." : "Calculate"}
        </Button>
      </form>
      {calc.isError && <p className="text-sm text-destructive">Couldn&apos;t calculate payoff.</p>}
      {calc.data && (
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Metric label="Months" value={String(calc.data.months)} />
          <Metric label="Total interest" value={formatCurrency(calc.data.total_interest, { currency: loan.currency })} />
          <Metric label="Total paid" value={formatCurrency(calc.data.total_paid, { currency: loan.currency })} />
        </div>
      )}
      {calc.data?.warning && <p className="text-sm text-c2">{calc.data.warning}</p>}
    </section>
  );
}

function EditSection({ loan, onDone, onDeleted }: { loan: Loan; onDone: () => void; onDeleted: () => void }) {
  const patch = usePatchLoan();
  const del = useDeleteLoan();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Edit loan</h3>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
      <LoanForm
        loan={loan}
        pending={patch.isPending}
        submitLabel="Save changes"
        onSubmit={async (payload) => {
          try {
            await patch.mutateAsync({ id: loan.id, body: payload });
            toast.success("Loan updated");
            onDone();
          } catch {
            toast.error("Couldn't update loan");
          }
        }}
      />
      <div className="border-t border-border pt-4">
        {confirming ? (
          <div className="flex items-center gap-3">
            <p className="text-sm text-destructive">Delete this loan and its history?</p>
            <Button
              variant="destructive"
              disabled={del.isPending}
              onClick={async () => {
                try {
                  await del.mutateAsync(loan.id);
                  toast.success("Loan deleted");
                  onDeleted();
                } catch {
                  toast.error("Couldn't delete loan");
                }
              }}
            >
              Confirm delete
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        ) : (
          <Button variant="outline" className="text-destructive" onClick={() => setConfirming(true)}>
            Delete loan
          </Button>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted">{label}</p>
      <p data-numeric className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
```

Note: `num` is imported-style declared but only used if needed; if `npm run lint` flags it as unused, delete the `const num` line.

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
cd web && npm run typecheck && npm run lint
```
Expected: no errors. (Confirm `Button` supports `variant="outline" | "ghost" | "destructive"`; if not, check `components/ui/button.tsx` variants and adjust the prop values to existing ones.)

- [ ] **Step 3: Run the frontend unit suite (regression)**

Run:
```bash
cd web && npm run test:unit
```
Expected: all pass (including existing `debt-widget` tests, which are unaffected).

- [ ] **Step 4: Manual verification**

Start backend (`:8000`) and `cd web && npm run dev`. In the app:
1. `/debt` shows loan cards with outstanding balance + progress bar.
2. Click a card → detail sheet. "Payment history" is collapsed by default.
3. Expand it, log a payment → toast, history row appears with principal/interest split, card outstanding drops, "Upcoming schedule" first balance reflects the payment.
4. Delete the payment → schedule/outstanding restore.
5. "Edit loan" → change the EMI, save → toast, card updates. "Delete loan" → confirm → sheet closes, card gone.

- [ ] **Step 5: Commit**

```bash
git add web/components/debt/loan-detail.tsx
git commit -m "feat(debt): detail sheet with payment history, logging, edit and delete"
```

---

## Self-Review Notes

- **Spec coverage:** rich cards (Task 7), collapsed paginated history (Task 8), editable loans (Tasks 5/6/8), real payment logging + full recompute (Tasks 1–4), `LoanOut` derived fields (Tasks 2–3), shared form dedupe (Task 6), payoff strategy/calc retained (Tasks 7/8). Out-of-scope items (credit-card detail, day-accurate accrual, transaction linking) intentionally excluded.
- **Type consistency:** `record_payment`/`delete_payment`/`list_payments` names match between service (Task 3), router (Task 4), and tests. Hook names (`usePatchLoan`, `useLoanPayments`, `useCreatePayment`, `useDeletePayment`) match between Task 5 and Task 8. `loanToFormDefaults`/`formToLoanIn`/`LoanForm` match between Task 6 and Tasks 7/8. `_project` keyword args (`start_balance`, `start`, `first_no`) consistent between definition (Task 3 Step 4) and call site (Step 5).
- **Behavior preservation:** `_project` default path reproduces the original loop exactly (verified by Task 3 Step 9 running the pre-existing EMI test).
- **Known N+1:** `list_loans` calls `_loan_out` per loan, each issuing one payments query. Acceptable at household scale.
