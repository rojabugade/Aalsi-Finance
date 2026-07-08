from __future__ import annotations

import uuid
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.memory.ingest import enqueue_index_source
from app.auth.deps import scoped_query
from app.loans import service as loan_service
from app.models.accounts import AccountLogical, PaymentMethod
from app.models.core import User
from app.models.debt import CreditCardDetail, Loan
from app.models.investments import HoldingValuation, InvestmentHolding
from app.models.transactions import Category, Merchant, RecurringSeries
from app.widget_data.schemas import (
    CreditCardDetailIn,
    HoldingIn,
    HoldingPatch,
    PaymentMethodIn,
    PaymentMethodPatch,
    RecurringSeriesIn,
    RecurringSeriesPatch,
    ValuationIn,
)


class NotFound(Exception):
    pass


class InvalidReference(Exception):
    pass


def _money(value: Decimal | int | str | float | None) -> Decimal:
    return Decimal(str(value or "0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


async def _get_scoped(session: AsyncSession, user: User, model, row_id: uuid.UUID, label: str):
    row = (await session.execute(scoped_query(model, user).where(model.id == row_id))).scalar_one_or_none()
    if row is None:
        raise NotFound(f"{label} not found")
    return row


async def _validate_account(session: AsyncSession, user: User, account_id: uuid.UUID | None, *, investment: bool = False) -> None:
    if account_id is None:
        return
    account = await _get_scoped(session, user, AccountLogical, account_id, "Account")
    if investment and account.type != "investment":
        raise InvalidReference("Holding account must have type=investment")


async def _validate_refs(session: AsyncSession, user: User, values: dict) -> None:
    await _validate_account(session, user, values.get("account_id"))
    payment_id = values.get("payment_method_id")
    if payment_id is not None:
        await _get_scoped(session, user, PaymentMethod, payment_id, "Payment method")
    for key, model, label in (("merchant_id", Merchant, "Merchant"), ("category_id", Category, "Category")):
        row_id = values.get(key)
        if row_id is None:
            continue
        row = await session.get(model, row_id)
        if row is None or row.household_id not in (None, user.household_id):
            raise NotFound(f"{label} not found")


async def list_payment_methods(session: AsyncSession, user: User) -> list[PaymentMethod]:
    stmt = scoped_query(PaymentMethod, user).order_by(PaymentMethod.is_active.desc(), PaymentMethod.name)
    return list((await session.execute(stmt)).scalars().all())


async def create_payment_method(session: AsyncSession, user: User, data: PaymentMethodIn) -> PaymentMethod:
    await _validate_account(session, user, data.account_id)
    row = PaymentMethod(household_id=user.household_id, owner_user_id=user.id, **data.model_dump())
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def patch_payment_method(session: AsyncSession, user: User, row_id: uuid.UUID, data: PaymentMethodPatch) -> PaymentMethod:
    row = await _get_scoped(session, user, PaymentMethod, row_id, "Payment method")
    values = data.model_dump(exclude_unset=True)
    if "account_id" in values:
        await _validate_account(session, user, values["account_id"])
    for key, value in values.items():
        setattr(row, key, value)
    await session.commit()
    await session.refresh(row)
    return row


async def delete_payment_method(session: AsyncSession, user: User, row_id: uuid.UUID) -> None:
    row = await _get_scoped(session, user, PaymentMethod, row_id, "Payment method")
    await session.delete(row)
    await session.commit()


async def list_credit_cards(session: AsyncSession, user: User) -> list[dict]:
    cards = (await session.execute(scoped_query(Loan, user).where(Loan.type == "credit_card").order_by(Loan.due_day, Loan.name))).scalars().all()
    out = []
    for card in cards:
        detail = await session.get(CreditCardDetail, card.id)
        limit = _money(detail.credit_limit) if detail else None
        balance = _money(detail.statement_balance) if detail and detail.statement_balance is not None else _money(card.principal)
        available = _money(detail.available_credit) if detail and detail.available_credit is not None else (_money(limit - balance) if limit is not None else None)
        utilization = _money(balance / limit * 100) if limit else None
        out.append({
            "loan": await loan_service._loan_out(session, card),
            "credit_limit": limit,
            "statement_balance": _money(detail.statement_balance) if detail and detail.statement_balance is not None else None,
            "available_credit": available,
            "statement_day": detail.statement_day if detail else None,
            "utilization": utilization,
            "detail_complete": detail is not None,
        })
    return out


async def upsert_credit_card_detail(session: AsyncSession, user: User, loan_id: uuid.UUID, data: CreditCardDetailIn) -> dict:
    try:
        loan = await loan_service.get_loan(session, user, loan_id)
    except loan_service.NotFound as exc:
        raise NotFound(str(exc)) from exc
    if loan.type != "credit_card":
        raise InvalidReference("Credit-card detail requires a loan with type=credit_card")
    detail = await session.get(CreditCardDetail, loan.id)
    values = data.model_dump()
    if detail is None:
        detail = CreditCardDetail(loan_id=loan.id, **values)
        session.add(detail)
    else:
        for key, value in values.items():
            setattr(detail, key, value)
    await session.commit()
    return next(card for card in await list_credit_cards(session, user) if card["loan"]["id"] == loan.id)


async def list_recurring(session: AsyncSession, user: User, status: str | None = None) -> list[dict]:
    stmt = scoped_query(RecurringSeries, user)
    if status:
        stmt = stmt.where(RecurringSeries.status == status)
    rows = (await session.execute(stmt.order_by(RecurringSeries.next_due_date.nulls_last(), RecurringSeries.name))).scalars().all()
    merchant_ids = {r.merchant_id for r in rows if r.merchant_id}
    category_ids = {r.category_id for r in rows if r.category_id}
    merchants = {r.id: r.canonical_name for r in (await session.execute(select(Merchant).where(Merchant.id.in_(merchant_ids)))).scalars().all()} if merchant_ids else {}
    categories = {r.id: r.name for r in (await session.execute(select(Category).where(Category.id.in_(category_ids)))).scalars().all()} if category_ids else {}
    return [{**{c.name: getattr(row, c.name) for c in row.__table__.columns}, "merchant_name": merchants.get(row.merchant_id), "category_name": categories.get(row.category_id)} for row in rows]


async def create_recurring(session: AsyncSession, user: User, data: RecurringSeriesIn) -> dict:
    values = data.model_dump()
    await _validate_refs(session, user, values)
    values["currency"] = values["currency"].upper()
    row = RecurringSeries(household_id=user.household_id, owner_user_id=user.id, **values)
    session.add(row)
    await session.commit()
    enqueue_index_source(user.household_id, "recurring", [row.id])
    return await _recurring_out(session, row)


async def _recurring_out(session: AsyncSession, row: RecurringSeries) -> dict:
    merchant = await session.get(Merchant, row.merchant_id) if row.merchant_id else None
    category = await session.get(Category, row.category_id) if row.category_id else None
    return {**{c.name: getattr(row, c.name) for c in row.__table__.columns}, "merchant_name": merchant.canonical_name if merchant else None, "category_name": category.name if category else None}


async def patch_recurring(session: AsyncSession, user: User, row_id: uuid.UUID, data: RecurringSeriesPatch) -> dict:
    row = await _get_scoped(session, user, RecurringSeries, row_id, "Recurring series")
    values = data.model_dump(exclude_unset=True)
    await _validate_refs(session, user, values)
    if values.get("currency"):
        values["currency"] = values["currency"].upper()
    for key, value in values.items():
        setattr(row, key, value)
    await session.commit()
    enqueue_index_source(user.household_id, "recurring", [row.id])
    return await _recurring_out(session, row)


async def delete_recurring(session: AsyncSession, user: User, row_id: uuid.UUID) -> None:
    row = await _get_scoped(session, user, RecurringSeries, row_id, "Recurring series")
    await session.delete(row)
    await session.commit()


async def list_holdings(session: AsyncSession, user: User) -> list[dict]:
    rows = (await session.execute(scoped_query(InvestmentHolding, user).order_by(InvestmentHolding.name))).scalars().all()
    out = []
    for row in rows:
        latest = (await session.execute(select(HoldingValuation).where(HoldingValuation.holding_id == row.id).order_by(HoldingValuation.as_of.desc()).limit(1))).scalar_one_or_none()
        out.append({**{c.name: getattr(row, c.name) for c in row.__table__.columns}, "latest_valuation": latest})
    return out


async def create_holding(session: AsyncSession, user: User, data: HoldingIn) -> dict:
    await _validate_account(session, user, data.account_id, investment=True)
    values = data.model_dump()
    values["currency"] = values["currency"].upper()
    values["symbol"] = values["symbol"].upper() if values["symbol"] else None
    row = InvestmentHolding(household_id=user.household_id, owner_user_id=user.id, **values)
    session.add(row)
    await session.commit()
    return {**{c.name: getattr(row, c.name) for c in row.__table__.columns}, "latest_valuation": None}


async def patch_holding(session: AsyncSession, user: User, row_id: uuid.UUID, data: HoldingPatch) -> dict:
    row = await _get_scoped(session, user, InvestmentHolding, row_id, "Holding")
    values = data.model_dump(exclude_unset=True)
    if "account_id" in values:
        await _validate_account(session, user, values["account_id"], investment=True)
    if values.get("currency"):
        values["currency"] = values["currency"].upper()
    if values.get("symbol"):
        values["symbol"] = values["symbol"].upper()
    for key, value in values.items():
        setattr(row, key, value)
    await session.commit()
    return next(item for item in await list_holdings(session, user) if item["id"] == row.id)


async def delete_holding(session: AsyncSession, user: User, row_id: uuid.UUID) -> None:
    row = await _get_scoped(session, user, InvestmentHolding, row_id, "Holding")
    await session.delete(row)
    await session.commit()


async def add_valuation(session: AsyncSession, user: User, holding_id: uuid.UUID, data: ValuationIn) -> HoldingValuation:
    holding = await _get_scoped(session, user, InvestmentHolding, holding_id, "Holding")
    value = _money(data.value) if data.value is not None else _money(data.price * holding.quantity)
    row = HoldingValuation(household_id=user.household_id, holding_id=holding.id, as_of=data.as_of, price=_money(data.price), value=value)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def list_valuations(session: AsyncSession, user: User, holding_id: uuid.UUID) -> list[HoldingValuation]:
    holding = await _get_scoped(session, user, InvestmentHolding, holding_id, "Holding")
    stmt = select(HoldingValuation).where(HoldingValuation.holding_id == holding.id).order_by(HoldingValuation.as_of)
    return list((await session.execute(stmt)).scalars().all())
