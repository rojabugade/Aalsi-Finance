from __future__ import annotations

import calendar
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.memory.ingest import enqueue_index_source
from app.auth.deps import scoped_query
from app.fx import service as fx_service
from app.loans.schemas import LoanIn, LoanPatch, LoanPaymentIn, PayoffCalcIn, PayoffStrategyIn
from app.models.core import User
from app.models.debt import CreditCardDetail, Loan, LoanPayment, PaymentSchedule
from app.notifications.service import enqueue_notification


class NotFound(Exception):
    pass


def _money(value: Decimal | int | str | float | None) -> Decimal:
    return Decimal(str(value or "0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _rate(value: Decimal | int | str | float | None) -> Decimal:
    return Decimal(str(value or "0")) / Decimal("100")


def _monthly_rate(loan: Loan) -> Decimal:
    annual = _rate(loan.interest_rate)
    if loan.compounding == "daily":
        return annual / Decimal("365") * Decimal("30")
    return annual / Decimal("12")


def _add_months(value: date, months: int, due_day: int | None = None) -> date:
    month = value.month - 1 + months
    year = value.year + month // 12
    month = month % 12 + 1
    day = min(due_day or value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


async def list_loans(session: AsyncSession, user: User) -> list[dict]:
    loans = (await session.execute(scoped_query(Loan, user).order_by(Loan.name))).scalars().all()
    return [await _loan_out(session, loan) for loan in loans]


async def get_loan(session: AsyncSession, user: User, loan_id: uuid.UUID) -> Loan:
    loan = (await session.execute(scoped_query(Loan, user).where(Loan.id == loan_id))).scalar_one_or_none()
    if loan is None:
        raise NotFound("Loan not found")
    return loan


async def create_loan(session: AsyncSession, user: User, data: LoanIn) -> dict:
    loan = Loan(
        household_id=user.household_id,
        owner_user_id=user.id,
        name=data.name,
        type=data.type,
        schedule_kind=data.schedule_kind,
        principal=_money(data.principal),
        currency=data.currency.upper()[:3],
        interest_rate=data.interest_rate,
        compounding=data.compounding,
        min_or_emi_amount=_money(data.min_or_emi_amount) if data.min_or_emi_amount is not None else None,
        promo_rate=data.promo_rate,
        promo_expiry_date=data.promo_expiry_date,
        due_day=data.due_day,
        penalty_rules=data.penalty_rules or {},
        start_date=data.start_date or date.today(),
        end_date=data.end_date,
    )
    session.add(loan)
    await session.flush()
    await regenerate_schedule(session, user, loan)
    await session.commit()
    await session.refresh(loan)
    enqueue_index_source(user.household_id, "loan", [loan.id])
    return await _loan_out(session, loan)


async def patch_loan(session: AsyncSession, user: User, loan_id: uuid.UUID, data: LoanPatch) -> dict:
    loan = await get_loan(session, user, loan_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        if field in {"principal", "min_or_emi_amount"} and value is not None:
            value = _money(value)
        elif field == "currency" and value is not None:
            value = value.upper()[:3]
        setattr(loan, field, value)
    await regenerate_schedule(session, user, loan)
    await session.commit()
    await session.refresh(loan)
    enqueue_index_source(user.household_id, "loan", [loan.id])
    return await _loan_out(session, loan)


async def delete_loan(session: AsyncSession, user: User, loan_id: uuid.UUID) -> None:
    loan = await get_loan(session, user, loan_id)
    await session.delete(loan)
    await session.commit()


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


async def schedule(session: AsyncSession, user: User, loan_id: uuid.UUID) -> list[PaymentSchedule]:
    await get_loan(session, user, loan_id)
    stmt = select(PaymentSchedule).where(PaymentSchedule.loan_id == loan_id).order_by(PaymentSchedule.installment_no)
    return list((await session.execute(stmt)).scalars().all())


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


def _calculated_payment(loan: Loan) -> Decimal:
    principal = _money(loan.principal)
    if not loan.end_date or not loan.start_date:
        return principal
    months = max(1, (loan.end_date.year - loan.start_date.year) * 12 + loan.end_date.month - loan.start_date.month)
    rate = _monthly_rate(loan)
    if rate == 0:
        return _money(principal / months)
    factor = (Decimal("1") + rate) ** months
    return _money(principal * rate * factor / (factor - Decimal("1")))


async def payoff_calc(session: AsyncSession, user: User, loan_id: uuid.UUID, data: PayoffCalcIn) -> dict:
    loan = await get_loan(session, user, loan_id)
    projection = _project(loan, _money(data.monthly_payment), [(p.payment_date, _money(p.amount)) for p in data.extra_payments])
    total_interest = _money(sum((p["interest_component"] for p in projection), Decimal("0.00")))
    total_paid = _money(sum((p["payment"] for p in projection), Decimal("0.00")))
    warning = None
    if projection and projection[-1]["balance_after"] > 0:
        warning = "Projection capped at 600 months; payment may be too low to amortize this debt."
    return {
        "loan_id": loan.id,
        "months": len(projection),
        "total_interest": total_interest,
        "total_paid": total_paid,
        "projection": projection,
        "warning": warning,
    }


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


def defaultdict_money(extra_payments: list[tuple[date, Decimal]]) -> dict[tuple[int, int], Decimal]:
    out: dict[tuple[int, int], Decimal] = {}
    for payment_date, amount in extra_payments:
        key = (payment_date.year, payment_date.month)
        out[key] = _money(out.get(key, Decimal("0.00")) + amount)
    return out


async def payoff_strategy(session: AsyncSession, user: User, data: PayoffStrategyIn) -> dict:
    loans = (await session.execute(scoped_query(Loan, user))).scalars().all()
    if data.strategy == "avalanche":
        ordered = sorted(loans, key=lambda loan: (_rate(loan.interest_rate), _money(loan.principal)), reverse=True)
        reason = "highest interest rate first minimizes interest cost"
    else:
        ordered = sorted(loans, key=lambda loan: (_money(loan.principal), -_rate(loan.interest_rate)))
        reason = "smallest balance first creates faster payoff wins"
    return {
        "strategy": data.strategy,
        "ordered_plan": [
            {
                "loan_id": loan.id,
                "name": loan.name,
                "order": idx,
                "principal": _money(loan.principal),
                "interest_rate": Decimal(str(loan.interest_rate or 0)),
                "minimum_payment": _money(loan.min_or_emi_amount),
                "rationale": reason,
            }
            for idx, loan in enumerate(ordered, start=1)
        ],
    }


async def _loan_out(session: AsyncSession, loan: Loan) -> dict:
    next_due = (await session.execute(
        select(PaymentSchedule).where(PaymentSchedule.loan_id == loan.id, PaymentSchedule.status == "due").order_by(PaymentSchedule.due_date).limit(1)
    )).scalar_one_or_none()
    due_date = next_due.due_date if next_due else loan.start_date
    base_currency = await fx_service.household_base_currency(session, loan.household_id)
    base_principal = None
    base_minimum = None
    try:
        base_principal = (await fx_service.convert(session, loan.principal, loan.currency, base_currency, loan.start_date or date.today()))[0]
        if loan.min_or_emi_amount is not None:
            base_minimum = (await fx_service.convert(session, loan.min_or_emi_amount, loan.currency, base_currency, loan.start_date or date.today()))[0]
    except fx_service.FXRateUnavailable:
        pass
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
    card_detail = None
    if loan.type == "credit_card":
        cc = (await session.execute(
            select(CreditCardDetail).where(CreditCardDetail.loan_id == loan.id)
        )).scalar_one_or_none()
        if cc is not None:
            limit = _money(cc.credit_limit)
            utilization = (
                round(float(outstanding / limit), 4) if limit and limit > 0 else None
            )
            card_detail = {
                "credit_limit": limit,
                "statement_balance": _money(cc.statement_balance) if cc.statement_balance is not None else None,
                "available_credit": _money(cc.available_credit) if cc.available_credit is not None else None,
                "statement_day": cc.statement_day,
                "utilization": utilization,
            }
    return {
        "id": loan.id,
        "household_id": loan.household_id,
        "owner_user_id": loan.owner_user_id,
        "name": loan.name,
        "type": loan.type,
        "schedule_kind": loan.schedule_kind,
        "principal": _money(loan.principal),
        "currency": loan.currency,
        "interest_rate": Decimal(str(loan.interest_rate)) if loan.interest_rate is not None else None,
        "compounding": loan.compounding,
        "min_or_emi_amount": _money(loan.min_or_emi_amount),
        "promo_rate": Decimal(str(loan.promo_rate)) if loan.promo_rate is not None else None,
        "promo_expiry_date": loan.promo_expiry_date,
        "due_day": loan.due_day,
        "penalty_rules": loan.penalty_rules,
        "start_date": loan.start_date,
        "end_date": loan.end_date,
        "next_due_date": due_date,
        "penalty_warning": _penalty_warning(loan, due_date),
        "base_currency": base_currency,
        "base_principal": base_principal,
        "base_min_or_emi_amount": base_minimum,
        "outstanding_balance": outstanding,
        "total_paid": total_paid,
        "total_principal_paid": total_principal_paid,
        "total_interest_paid": total_interest_paid,
        "progress_pct": progress_pct,
        "credit_card_detail": card_detail,
    }


def _penalty_warning(loan: Loan, due_date: date | None) -> str | None:
    if not due_date or not loan.penalty_rules:
        return None
    days_until_due = (due_date - date.today()).days
    if days_until_due > int(loan.penalty_rules.get("warning_days", 7)):
        return None
    late_fee = loan.penalty_rules.get("late_fee")
    penalty_apr = loan.penalty_rules.get("penalty_apr")
    parts = []
    if late_fee:
        parts.append(f"late fee {late_fee} {loan.currency}")
    if penalty_apr:
        parts.append(f"penalty APR {penalty_apr}%")
    return "Due soon" + (f"; possible {' and '.join(parts)}" if parts else "")


async def _ensure_due_notification(session: AsyncSession, user: User, loan: Loan, due_date: date) -> None:
    scheduled_for = datetime.combine(due_date - timedelta(days=3), datetime.min.time(), tzinfo=timezone.utc)
    await enqueue_notification(
        session,
        household_id=user.household_id,
        user_id=user.id,
        type="loan_due",
        payload={"loan_id": loan.id, "due_date": due_date, "penalty_rules": loan.penalty_rules or {}},
        scheduled_for=scheduled_for,
        idempotency_key=f"loan_due:{loan.id}:{due_date.isoformat()}",
    )
