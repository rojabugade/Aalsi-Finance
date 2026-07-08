from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.accounts import AccountLogical
from app.models.core import Household
from app.models.fx import CrossBorderTransfer, FXRate
from app.models.income import IncomeSource
from app.models.debt import Loan
from app.models.transactions import Transaction

log = structlog.get_logger()


class FXRateUnavailable(Exception):
    pass


def normalize_currency(value: str | None, default: str = "USD") -> str:
    return (value or default).upper()[:3]


def normalize_pair(pair: str) -> str:
    cleaned = pair.upper().replace("-", "/")
    if "/" not in cleaned and len(cleaned) == 6:
        cleaned = f"{cleaned[:3]}/{cleaned[3:]}"
    parts = cleaned.split("/", 1)
    if len(parts) != 2 or len(parts[0]) != 3 or len(parts[1]) != 3:
        raise ValueError("pair must look like USD/INR")
    return f"{parts[0]}/{parts[1]}"


def money(value: Decimal | int | str | float | None) -> Decimal:
    return Decimal(str(value or "0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def rate_decimal(value: Decimal | int | str | float) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.00000001"), rounding=ROUND_HALF_UP)


async def household_base_currency(session: AsyncSession, household_id) -> str:
    household = await session.get(Household, household_id)
    return normalize_currency(household.base_currency if household else None)


async def set_household_base_currency(session: AsyncSession, household_id, currency: str) -> Household:
    household = await session.get(Household, household_id)
    if household is None:
        raise FXRateUnavailable("Household not found")
    household.base_currency = normalize_currency(currency)
    await session.commit()
    await session.refresh(household)
    return household


async def get_rate(session: AsyncSession, pair: str, as_of: date) -> tuple[Decimal, date]:
    pair = normalize_pair(pair)
    direct = await _nearest_prior(session, pair, as_of)
    if direct is not None:
        return direct.rate, direct.date
    source, target = pair.split("/")
    inverse = await _nearest_prior(session, f"{target}/{source}", as_of)
    if inverse is not None:
        return rate_decimal(Decimal("1") / Decimal(str(inverse.rate))), inverse.date
    raise FXRateUnavailable(f"No FX rate for {pair} on or before {as_of}")


async def convert(
    session: AsyncSession,
    amount: Decimal | int | str | float,
    from_currency: str,
    to_currency: str,
    as_of: date,
) -> tuple[Decimal, Decimal, date]:
    source = normalize_currency(from_currency)
    target = normalize_currency(to_currency)
    amount_dec = money(amount)
    if source == target:
        return amount_dec, Decimal("1.00000000"), as_of
    rate, rate_date = await get_rate(session, f"{source}/{target}", as_of)
    return money(amount_dec * rate), rate, rate_date


async def convert_to_household_base(
    session: AsyncSession,
    household_id,
    amount: Decimal | int | str | float,
    currency: str,
    as_of: date,
) -> tuple[Decimal, Decimal, date, str]:
    base = await household_base_currency(session, household_id)
    converted, fx_rate, rate_date = await convert(session, amount, currency, base, as_of)
    return converted, fx_rate, rate_date, base


async def upsert_rate(session: AsyncSession, pair: str, rate_date: date, rate: Decimal | int | str | float) -> FXRate:
    pair = normalize_pair(pair)
    value = rate_decimal(rate)
    stmt = (
        insert(FXRate)
        .values(currency_pair=pair, date=rate_date, rate=value)
        .on_conflict_do_update(
            index_elements=[FXRate.currency_pair, FXRate.date],
            set_={"rate": value},
        )
    )
    await session.execute(stmt)
    await session.commit()
    return (await session.execute(select(FXRate).where(FXRate.currency_pair == pair, FXRate.date == rate_date))).scalar_one()


async def refresh_used_rates(session: AsyncSession, pairs: set[str] | None = None) -> dict:
    requested_pairs = pairs or await used_pairs(session)
    requested_pairs = {normalize_pair(pair) for pair in requested_pairs}
    refreshed = 0
    skipped = 0
    errors: list[str] = []
    async with httpx.AsyncClient(timeout=15.0) as client:
        for pair in sorted(requested_pairs):
            try:
                row = await fetch_public_rate(client, pair)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{pair}: {exc}")
                log.warning("fx.refresh_pair_failed", pair=pair, error=str(exc))
                continue
            if row is None:
                skipped += 1
                continue
            rate_date, value = row
            await upsert_rate(session, pair, rate_date, value)
            refreshed += 1
    return {
        "requested": len(requested_pairs),
        "refreshed": refreshed,
        "failed": len(errors),
        "skipped": skipped,
        "errors": errors,
    }


async def fetch_public_rate(client: httpx.AsyncClient, pair: str) -> tuple[date, Decimal] | None:
    pair = normalize_pair(pair)
    source, target = pair.split("/")
    if source == target:
        return date.today(), Decimal("1")
    base_url = get_settings().fx_api_base_url.rstrip("/")
    response = await client.get(f"{base_url}/latest", params={"from": source, "to": target})
    response.raise_for_status()
    payload = response.json()
    value = (payload.get("rates") or {}).get(target)
    if value is None:
        return None
    return date.fromisoformat(payload["date"]), Decimal(str(value))


async def used_pairs(session: AsyncSession) -> set[str]:
    pairs = {"USD/INR"}
    household_bases = dict((await session.execute(select(Household.id, Household.base_currency))).all())

    async def add_currency_pairs(rows):
        for household_id, currency in rows:
            base = normalize_currency(household_bases.get(household_id))
            cur = normalize_currency(currency)
            if cur != base:
                pairs.add(f"{cur}/{base}")

    await add_currency_pairs((await session.execute(select(Transaction.household_id, Transaction.currency).distinct())).all())
    await add_currency_pairs((await session.execute(select(AccountLogical.household_id, AccountLogical.currency).distinct())).all())
    await add_currency_pairs((await session.execute(select(Loan.household_id, Loan.currency).distinct())).all())
    await add_currency_pairs((await session.execute(select(IncomeSource.household_id, IncomeSource.currency).distinct())).all())

    transfer_rows = (await session.execute(select(CrossBorderTransfer.from_currency, CrossBorderTransfer.to_currency).distinct())).all()
    for from_currency, to_currency in transfer_rows:
        source = normalize_currency(from_currency)
        target = normalize_currency(to_currency)
        if source != target:
            pairs.add(f"{source}/{target}")
    return pairs


async def _nearest_prior(session: AsyncSession, pair: str, as_of: date) -> FXRate | None:
    stmt = (
        select(FXRate)
        .where(FXRate.currency_pair == pair, FXRate.date <= as_of)
        .order_by(FXRate.date.desc())
        .limit(1)
    )
    return (await session.execute(stmt)).scalar_one_or_none()
