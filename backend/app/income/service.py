from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import scoped_query
from app.fx import service as fx_service
from app.models.core import User
from app.models.documents import Document
from app.models.income import EquityEvent, EquityGrant, IncomeSource, Paystub
from app.income.schemas import (
    EquityEventIn,
    EquityGrantIn,
    IncomeSourceIn,
    IncomeSourcePatch,
    PaystubIn,
)

DISCLAIMER = (
    "Illustrative estimate only; not tax, legal, investment, or payroll advice. "
    "Consult a CPA/CA or licensed professional before acting."
)

FREQ_MULT = {"weekly": Decimal("52"), "biweekly": Decimal("26"), "semimonthly": Decimal("24"), "monthly": Decimal("12"), "annual": Decimal("1")}


class NotFound(Exception):
    pass


def _money(v: Decimal | str | int | float | None, default: Decimal = Decimal("0.00")) -> Decimal:
    if v is None:
        return default
    return Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _currency(v: str | None) -> str:
    return (v or "USD").upper()[:3]


async def list_income_sources(session: AsyncSession, user: User) -> list[IncomeSource]:
    return list((await session.execute(scoped_query(IncomeSource, user))).scalars().all())


async def create_income_source(session: AsyncSession, user: User, data: IncomeSourceIn) -> IncomeSource:
    row = IncomeSource(
        household_id=user.household_id,
        owner_user_id=user.id,
        employer=data.employer,
        country=(data.country or "").upper()[:2] or None,
        currency=_currency(data.currency),
        frequency=data.frequency,
        gross=_money(data.gross) if data.gross is not None else None,
        net=_money(data.net) if data.net is not None else None,
        withholding=data.withholding or {},
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def get_income_source(session: AsyncSession, user: User, source_id: uuid.UUID) -> IncomeSource:
    row = (await session.execute(scoped_query(IncomeSource, user).where(IncomeSource.id == source_id))).scalar_one_or_none()
    if row is None:
        raise NotFound("Income source not found")
    return row


async def patch_income_source(session: AsyncSession, user: User, source_id: uuid.UUID, data: IncomeSourcePatch) -> IncomeSource:
    row = await get_income_source(session, user, source_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "currency" and value is not None:
            value = _currency(value)
        if field == "country" and value is not None:
            value = value.upper()[:2]
        if field in {"gross", "net"} and value is not None:
            value = _money(value)
        setattr(row, field, value)
    await session.commit()
    await session.refresh(row)
    return row


async def create_paystub(session: AsyncSession, user: User, data: PaystubIn) -> Paystub:
    source = await get_income_source(session, user, data.income_source_id)
    values = data.model_dump()
    if data.source_document_id:
        doc = await session.get(Document, data.source_document_id)
        if doc is None or doc.household_id != user.household_id or doc.type != "paystub":
            raise NotFound("Paystub document not found")
        extracted = ((doc.ocr_meta or {}).get("ocr") or {}).get("data") or {}
        values["period_start"] = values["period_start"] or _date(extracted.get("period_start"))
        values["period_end"] = values["period_end"] or _date(extracted.get("period_end"))
        values["gross"] = values["gross"] or extracted.get("gross")
        values["net"] = values["net"] or extracted.get("net")
        values["deductions"] = values["deductions"] or {"items": extracted.get("deductions", [])}
        if extracted.get("employer") and not source.employer:
            source.employer = extracted["employer"]
    row = Paystub(
        income_source_id=source.id,
        source_document_id=data.source_document_id,
        period_start=values.get("period_start"),
        period_end=values.get("period_end"),
        gross=_money(values.get("gross")) if values.get("gross") is not None else None,
        deductions=values.get("deductions") or {},
        net=_money(values.get("net")) if values.get("net") is not None else None,
    )
    if row.gross is not None:
        source.gross = row.gross
    if row.net is not None:
        source.net = row.net
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def create_equity_grant(session: AsyncSession, user: User, data: EquityGrantIn) -> EquityGrant:
    source = await get_income_source(session, user, data.income_source_id)
    row = EquityGrant(
        income_source_id=source.id,
        type=data.type,
        ticker=data.ticker.upper() if data.ticker else None,
        country=(data.country or source.country or "").upper()[:2] or None,
        grant_date=data.grant_date,
        shares=data.shares,
        strike_price=_money(data.strike_price) if data.strike_price is not None else None,
        vesting_schedule=data.vesting_schedule or {},
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def list_equity_grants(session: AsyncSession, user: User) -> list[EquityGrant]:
    stmt = select(EquityGrant).join(IncomeSource, EquityGrant.income_source_id == IncomeSource.id).where(IncomeSource.household_id == user.household_id)
    return list((await session.execute(stmt)).scalars().all())


async def create_equity_event(session: AsyncSession, user: User, data: EquityEventIn) -> EquityEvent:
    grant = await _get_grant(session, user, data.equity_grant_id)
    est_tax = data.est_tax or _estimate_equity_tax(grant, data)
    row = EquityEvent(
        equity_grant_id=grant.id,
        type=data.type,
        event_date=data.event_date,
        shares=data.shares,
        fmv=_money(data.fmv) if data.fmv is not None else None,
        proceeds=_money(data.proceeds) if data.proceeds is not None else None,
        est_tax=est_tax,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def list_equity_events(session: AsyncSession, user: User) -> list[EquityEvent]:
    stmt = (
        select(EquityEvent)
        .join(EquityGrant, EquityEvent.equity_grant_id == EquityGrant.id)
        .join(IncomeSource, EquityGrant.income_source_id == IncomeSource.id)
        .where(IncomeSource.household_id == user.household_id)
    )
    return list((await session.execute(stmt)).scalars().all())


async def equity_summary(session: AsyncSession, user: User) -> dict:
    grants = await list_equity_grants(session, user)
    events = await list_equity_events(session, user)
    by_grant: dict[uuid.UUID, list[EquityEvent]] = {}
    for event in events:
        by_grant.setdefault(event.equity_grant_id, []).append(event)
    out, total_value, total_unvested = [], Decimal("0.00"), Decimal("0.00")
    today = date.today()
    for grant in grants:
        grant_events = by_grant.get(grant.id, [])
        vested_shares = sum((_money(e.shares) for e in grant_events if e.type == "vest"), Decimal("0.00"))
        vested_value = sum((_money(e.shares) * _money(e.fmv) for e in grant_events if e.type == "vest"), Decimal("0.00"))
        grant_shares = _money(grant.shares)
        unvested = max(Decimal("0.00"), grant_shares - vested_shares)
        upcoming = [e for e in (grant.vesting_schedule or {}).get("events", []) if e.get("date") and _date(e["date"]) and _date(e["date"]) >= today]
        out.append({
            "grant_id": grant.id,
            "ticker": grant.ticker,
            "type": grant.type,
            "vested_shares": vested_shares,
            "unvested_shares": unvested,
            "vested_value": _money(vested_value),
            "upcoming_vests": upcoming[:5],
        })
        total_value += vested_value
        total_unvested += unvested
    return {"vested_value": _money(total_value), "unvested_shares": _money(total_unvested), "grants": out, "disclaimer": DISCLAIMER}


async def take_home_estimate(session: AsyncSession, user: User, source_id: uuid.UUID) -> dict:
    source = await get_income_source(session, user, source_id)
    gross_period = _money(source.gross)
    mult = FREQ_MULT.get(source.frequency, Decimal("12"))
    annual = _money(gross_period * mult)
    country = (source.country or "").upper()
    if country == "IN":
        estimates = _india_estimate(annual)
    else:
        estimates = _us_estimate(annual, source.withholding or {})
    base_currency = await fx_service.household_base_currency(session, user.household_id)
    gross_period_base = None
    gross_annual_base = None
    try:
        gross_period_base = (await fx_service.convert(session, gross_period, source.currency, base_currency, date.today()))[0]
        gross_annual_base = (await fx_service.convert(session, annual, source.currency, base_currency, date.today()))[0]
    except fx_service.FXRateUnavailable:
        pass
    return {"source_id": source.id, "country": source.country, "currency": source.currency, "gross_period": gross_period, "gross_annual": annual, "estimates": estimates, "disclaimer": DISCLAIMER, "base_currency": base_currency, "gross_period_base": gross_period_base, "gross_annual_base": gross_annual_base}


async def _get_grant(session: AsyncSession, user: User, grant_id: uuid.UUID) -> EquityGrant:
    stmt = (
        select(EquityGrant)
        .join(IncomeSource, EquityGrant.income_source_id == IncomeSource.id)
        .where(EquityGrant.id == grant_id, IncomeSource.household_id == user.household_id)
    )
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise NotFound("Equity grant not found")
    return row


def _estimate_equity_tax(grant: EquityGrant, data: EquityEventIn) -> dict:
    if data.type != "vest" or data.fmv is None or data.shares is None:
        return {"note": "Tax treatment depends on event type and jurisdiction; consult a professional.", "disclaimer": DISCLAIMER}
    income = _money(data.fmv) * _money(data.shares)
    rate = Decimal("0.30") if (grant.country or "US") == "US" else Decimal("0.20")
    return {"income_recognized": str(_money(income)), "estimated_tax": str(_money(income * rate)), "rate": str(rate), "disclaimer": DISCLAIMER}


def _us_estimate(annual: Decimal, withholding: dict) -> dict:
    state_rate = Decimal(str(withholding.get("state_rate", "0.05")))
    federal = max(Decimal("0.00"), annual - Decimal("14600")) * Decimal("0.12")
    fica = min(annual, Decimal("168600")) * Decimal("0.0765")
    state = annual * state_rate
    total = _money(federal + fica + state)
    return {"us": {"federal": str(_money(federal)), "fica": str(_money(fica)), "state": str(_money(state)), "estimated_total": str(total), "estimated_take_home": str(_money(annual - total))}}


def _india_estimate(annual: Decimal) -> dict:
    new_regime_tax = max(Decimal("0.00"), annual - Decimal("300000")) * Decimal("0.10")
    old_regime_tax = max(Decimal("0.00"), annual - Decimal("500000")) * Decimal("0.10")
    return {"india": {"new_regime": {"estimated_tax": str(_money(new_regime_tax)), "estimated_take_home": str(_money(annual - new_regime_tax))}, "old_regime": {"estimated_tax": str(_money(old_regime_tax)), "estimated_take_home": str(_money(annual - old_regime_tax))}}}


def _date(value: str | date | None) -> date | None:
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])
