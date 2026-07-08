from __future__ import annotations

import calendar
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

import structlog
from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import scoped_query
from app.fx import service as fx_service
from app.models.accounts import AccountBalance, AccountLogical
from app.models.core import Household, User
from app.models.debt import Loan, LoanPayment
from app.models.guidance import Recommendation
from app.models.investments import HoldingValuation, InvestmentHolding
from app.notifications.service import enqueue_notification
from app.models.transactions import (
    Budget,
    Category,
    LineItem,
    LineItemTag,
    Merchant,
    Tag,
    Transaction,
    TransactionTag,
)
from app.analytics.schemas import BudgetIn, BudgetPatch


log = structlog.get_logger()


class NotFound(Exception):
    pass


VALID_DIMENSIONS = {"merchant", "category", "subcategory", "item_type", "tag"}

# Account types that count toward net worth as assets vs. liabilities.
ASSET_TYPES = {"checking", "savings", "cash", "investment"}
LIABILITY_TYPES = {"credit", "loan"}

# Monthly rollup materialized view (see migration c4e7a1b9f2d8). Backs month-aligned
# timeseries reads; refreshed on transaction confirm via refresh_rollups().
ROLLUP_MV = "mv_household_monthly"


async def _rollup_available(session: AsyncSession) -> bool:
    """True when the rollup MV exists. to_regclass returns NULL (no error, no aborted
    transaction) when it doesn't, so un-migrated DBs fall back to live aggregation."""
    return (await session.scalar(text("SELECT to_regclass(CAST(:name AS text))"), {"name": ROLLUP_MV})) is not None


async def refresh_rollups(session: AsyncSession) -> None:
    """Refresh the monthly rollup. Best-effort and self-contained: skips cleanly when
    the MV is absent, and commits in its own transaction so a refresh hiccup never
    rolls back the caller's confirm. Non-concurrent refresh needs no unique index."""
    if not await _rollup_available(session):
        return
    try:
        await session.execute(text(f"REFRESH MATERIALIZED VIEW {ROLLUP_MV}"))
        await session.commit()
    except Exception as exc:  # noqa: BLE001
        await session.rollback()
        log.warning("analytics.rollup_refresh_failed", error=str(exc))


def _is_month_aligned(from_date: date, to_date: date) -> bool:
    """A window that starts on the 1st and ends on a month's last day can be answered
    exactly from monthly rollup rows; partial-month edges cannot."""
    last_day = calendar.monthrange(to_date.year, to_date.month)[1]
    return from_date.day == 1 and to_date.day == last_day


def _money(value: Decimal | int | str | float | None) -> Decimal:
    return Decimal(str(value or "0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _pct(part: Decimal, total: Decimal) -> Decimal:
    if total == 0:
        return Decimal("0.00")
    return ((part / total) * Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _period_start(today: date, period: str) -> date:
    if period == "yearly":
        return date(today.year, 1, 1)
    if period == "quarterly":
        month = ((today.month - 1) // 3) * 3 + 1
        return date(today.year, month, 1)
    if period == "weekly":
        return today - timedelta(days=today.weekday())
    return date(today.year, today.month, 1)


async def summary(
    session: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
    group_by: list[str],
    compare: str | None = None,
) -> dict:
    dims = [d for d in group_by if d in VALID_DIMENSIONS]
    rows, total = await _aggregate(session, user, from_date, to_date, dims)
    comparison = None
    if compare == "prev":
        days = (to_date - from_date).days + 1
        prev_to = from_date - timedelta(days=1)
        prev_from = prev_to - timedelta(days=days - 1)
        _, prev_total = await _aggregate(session, user, prev_from, prev_to, dims)
        comparison = {
            "from_date": prev_from.isoformat(),
            "to_date": prev_to.isoformat(),
            "total": str(prev_total),
            "delta": str(_money(total - prev_total)),
            "delta_pct": str(_pct(total - prev_total, prev_total)),
        }
    return {
        "from_date": from_date,
        "to_date": to_date,
        "group_by": dims,
        "total": total,
        "rows": rows,
        "comparison": comparison,
    }


async def breakdown(
    session: AsyncSession,
    user: User,
    dimension: str,
    filter_value: str | None,
    from_date: date,
    to_date: date,
) -> dict:
    rows, _ = await _aggregate(session, user, from_date, to_date, [dimension], spend_only=True)
    if filter_value:
        needle = filter_value.lower()
        rows = [r for r in rows if needle in str(next(iter(r["dimensions"].values()), "")).lower()]
    return {"dimension": dimension, "filter": filter_value, "rows": rows}


async def _to_base(
    session: AsyncSession,
    household_id: uuid.UUID,
    amount: Decimal,
    currency: str | None,
    as_of: date,
    base: str,
) -> Decimal:
    """Convert `amount` from `currency` to the household base currency at `as_of`.
    Falls back to the raw magnitude (logged) when no rate is on file, so a missing
    FX pair degrades to an approximation instead of dropping the balance entirely."""
    try:
        converted, _rate, _rate_date = await fx_service.convert(
            session, amount, currency or base, base, as_of
        )
        return _money(converted)
    except fx_service.FXRateUnavailable:
        log.warning("net_worth.fx_unavailable", currency=currency, base=base, as_of=str(as_of))
        return _money(amount)


async def _loan_outstanding(session: AsyncSession, loan: Loan) -> Decimal:
    """What's still owed on a loan: principal minus recorded principal payments.
    Mirrors loans.service so the Debt page and net worth agree on the balance."""
    rows = (
        await session.execute(
            select(LoanPayment.principal_component).where(LoanPayment.loan_id == loan.id)
        )
    ).scalars().all()
    paid = sum((Decimal(str(r or 0)) for r in rows), Decimal("0"))
    return max(Decimal("0.00"), _money(loan.principal) - _money(paid))


async def net_worth(
    session: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> dict:
    """Net worth in the household base currency: FX-converted account balances,
    plus manual/unsynced loan liabilities and investment holdings, minus what's
    owed. A month-by-month trend carries each account's last known balance forward.

    Composition:
    - Account balances (checking/savings/cash/investment add, credit/loan subtract),
      each converted to base at its snapshot date.
    - Loan outstanding as a liability, deduped against Plaid accounts already counted
      via their balance snapshot (a Plaid card yields both a balance row and a Loan;
      we keep the balance and drop the Loan to avoid double-counting). This surfaces
      manual loans and any Plaid liability that never got a balance snapshot.
    - Latest holding valuation as an asset, only for investment accounts that have no
      balance snapshot (otherwise the balance already reflects portfolio value).

    Loans and holdings are not historized, so their current value is applied to every
    trend point; the month-over-month *shape* comes from the balance snapshots.
    """
    household = await session.get(Household, user.household_id)
    base = (household.base_currency if household else "USD") or "USD"

    accounts = (await session.execute(scoped_query(AccountLogical, user))).scalars().all()
    acct_by_id = {a.id: a for a in accounts}
    balances = (
        await session.execute(
            scoped_query(AccountBalance, user).order_by(AccountBalance.as_of)
        )
    ).scalars().all()

    # Pre-convert each snapshot to base once (its value is fixed regardless of which
    # month reads it), so the per-month loop is pure arithmetic.
    by_account: dict[uuid.UUID, list[tuple[date, Decimal]]] = defaultdict(list)
    accounts_with_balance: set[uuid.UUID] = set()
    for bal in balances:  # ascending by as_of
        acct = acct_by_id.get(bal.account_id)
        if acct is None:
            continue
        accounts_with_balance.add(bal.account_id)
        base_val = await _to_base(session, user.household_id, bal.balance, acct.currency, bal.as_of, base)
        by_account[bal.account_id].append((bal.as_of, base_val))

    # Loan liabilities, deduping Plaid loans already represented as a balance snapshot.
    covered_plaid_ids = {
        a.plaid_account_id for a in accounts if a.plaid_account_id and a.id in accounts_with_balance
    }
    loans = (await session.execute(scoped_query(Loan, user))).scalars().all()
    loan_liability = Decimal("0.00")
    for loan in loans:
        if loan.plaid_account_id and loan.plaid_account_id in covered_plaid_ids:
            continue
        outstanding = await _loan_outstanding(session, loan)
        loan_liability += await _to_base(session, user.household_id, outstanding, loan.currency, to_date, base)

    # Holding assets, only for investment accounts with no balance snapshot.
    holdings = (await session.execute(scoped_query(InvestmentHolding, user))).scalars().all()
    holding_asset = Decimal("0.00")
    for holding in holdings:
        if holding.account_id in accounts_with_balance:
            continue
        valuation = (
            await session.execute(
                select(HoldingValuation)
                .where(HoldingValuation.holding_id == holding.id)
                .order_by(HoldingValuation.as_of.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if valuation is None:
            continue
        holding_asset += await _to_base(
            session, user.household_id, valuation.value, holding.currency, valuation.as_of, base
        )

    def snapshot(as_of: date) -> dict[str, Decimal]:
        assets = Decimal("0.00")
        liabilities = Decimal("0.00")
        for account_id, series in by_account.items():
            latest: Decimal | None = None
            for snap_date, value in series:  # ascending
                if snap_date <= as_of:
                    latest = value
                else:
                    break
            if latest is None:
                continue
            if acct_by_id[account_id].type in LIABILITY_TYPES:
                liabilities += latest
            else:
                assets += latest
        assets += holding_asset
        liabilities += loan_liability
        return {
            "assets": _money(assets),
            "liabilities": _money(liabilities),
            "net_worth": _money(assets - liabilities),
        }

    points: list[dict] = []
    cursor = date(from_date.year, from_date.month, 1)
    while cursor <= to_date:
        last_day = calendar.monthrange(cursor.year, cursor.month)[1]
        month_end = date(cursor.year, cursor.month, last_day)
        snap = snapshot(min(month_end, to_date))
        points.append({"period": _bucket_key(cursor, "monthly"), **snap})
        cursor = month_end + timedelta(days=1)

    current = snapshot(to_date)
    return {
        "as_of": to_date,
        "currency": base,
        **current,
        "points": points,
    }


async def _aggregate(
    session: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
    dims: list[str],
    spend_only: bool = False,
) -> tuple[list[dict], Decimal]:
    txns = await _visible_transactions(session, user, from_date, to_date)
    merchant_ids = [t.merchant_id for t in txns if t.merchant_id]
    category_ids = [t.category_id for t in txns if t.category_id]
    merchants = await _merchant_names(session, merchant_ids)
    category_rows = await _categories_with_parents(session, category_ids)
    categories = {cat_id: cat.name for cat_id, cat in category_rows.items()}
    line_items = await _line_items(session, [t.id for t in txns])
    item_category_ids = [i.item_type_category_id for items in line_items.values() for i in items if i.item_type_category_id]
    item_categories = await _category_names(session, item_category_ids)
    txn_tags = await _transaction_tags(session, [t.id for t in txns])
    line_tags = await _line_item_tags(session, [i.id for items in line_items.values() for i in items])

    grouped: dict[tuple[tuple[str, str | None], ...], dict] = {}
    total = Decimal("0.00")
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
        for item, amount, quantity in entries:
            tag_values = _tag_values(dims, txn.id, item.id if item else None, txn_tags, line_tags)
            for tag_value in tag_values:
                dimensions = _dimensions_for(txn, item, dims, merchants, categories, item_categories, tag_value)
                key = tuple(dimensions.items())
                row = grouped.setdefault(
                    key,
                    {"dimensions": dimensions, "total": Decimal("0.00"), "quantity": Decimal("0.0000"), "transaction_ids": set()},
                )
                row["total"] += amount
                row["quantity"] += Decimal(str(quantity or 0))
                row["transaction_ids"].add(txn.id)
                total += amount
    out = []
    for row in grouped.values():
        row_total = _money(row["total"])
        out.append(
            {
                "dimensions": row["dimensions"],
                "total": row_total,
                "quantity": row["quantity"] or None,
                "contribution_pct": _pct(row_total, total),
                "transaction_ids": sorted(row["transaction_ids"], key=str),
            }
        )
    out.sort(key=lambda r: r["total"], reverse=True)
    return out, _money(total)


def _is_income_transaction(txn: Transaction, categories: dict[uuid.UUID, Category]) -> bool:
    if (txn.flags or {}).get("type") == "income":
        return True
    if not txn.category_id:
        return False
    category = categories.get(txn.category_id)
    parent = categories.get(category.parent_id) if category and category.parent_id else None
    return (category is not None and category.name.lower() == "income") or (parent is not None and parent.name.lower() == "income")


def _dimensions_for(
    txn: Transaction,
    item: LineItem | None,
    dims: list[str],
    merchants: dict[uuid.UUID, str],
    categories: dict[uuid.UUID, str],
    item_categories: dict[uuid.UUID, str],
    tag_value: str | None,
) -> dict[str, str | None]:
    values: dict[str, str | None] = {}
    for dim in dims:
        if dim == "merchant":
            values[dim] = merchants.get(txn.merchant_id) if txn.merchant_id else None
        elif dim in {"category", "subcategory"}:
            values[dim] = categories.get(txn.category_id) if txn.category_id else None
        elif dim == "item_type":
            if item and item.item_type_category_id:
                values[dim] = item_categories.get(item.item_type_category_id)
            else:
                values[dim] = item.name if item else None
        elif dim == "tag":
            values[dim] = tag_value
    return values


def _tag_values(
    dims: list[str],
    txn_id: uuid.UUID,
    item_id: uuid.UUID | None,
    txn_tags: dict[uuid.UUID, list[str]],
    line_tags: dict[uuid.UUID, list[str]],
) -> list[str | None]:
    if "tag" not in dims:
        return [None]
    values = list(txn_tags.get(txn_id, []))
    if item_id:
        values.extend(line_tags.get(item_id, []))
    return values or [None]


async def timeseries(
    session: AsyncSession,
    user: User,
    metric: str,
    interval: str,
    from_date: date,
    to_date: date,
) -> dict:
    # Live aggregation is the source of truth because imported datasets may store
    # expenses as negative values and income as positive category/flagged rows.
    buckets = await _timeseries_buckets_live(session, user, interval, from_date, to_date)
    points = [{"period": k, **{m: _money(v) for m, v in values.items()}} for k, values in sorted(buckets.items())]
    if metric in {"spend", "income", "net"}:
        points = [{"period": p["period"], metric: p[metric]} for p in points]
    return {"metric": metric, "interval": interval, "from_date": from_date, "to_date": to_date, "points": points}


def _empty_buckets() -> dict[str, dict[str, Decimal]]:
    return defaultdict(lambda: {"spend": Decimal("0.00"), "income": Decimal("0.00"), "net": Decimal("0.00")})


async def _timeseries_buckets_live(
    session: AsyncSession, user: User, interval: str, from_date: date, to_date: date
) -> dict[str, dict[str, Decimal]]:
    buckets = _empty_buckets()
    txns = await _visible_transactions(session, user, from_date, to_date)
    category_rows = await _categories_with_parents(session, [txn.category_id for txn in txns if txn.category_id])
    for txn in txns:
        flags = txn.flags or {}
        if flags.get("transfer"):
            continue  # transfer/payment legs are money movement, not spend or income
        key = _bucket_key(txn.txn_date, interval)
        amount = _money(txn.base_amount if txn.base_amount is not None else txn.amount)
        if _is_income_transaction(txn, category_rows):
            buckets[key]["income"] += abs(amount)
        elif flags.get("refund"):
            buckets[key]["spend"] -= abs(amount)  # refunds net spend down, matching _aggregate
        else:
            buckets[key]["spend"] += abs(amount)
        buckets[key]["net"] = buckets[key]["income"] - buckets[key]["spend"]
    return buckets


async def _timeseries_buckets_rollup(
    session: AsyncSession, user: User, interval: str, from_date: date, to_date: date
) -> dict[str, dict[str, Decimal]]:
    rows = (await session.execute(
        text(
            f"SELECT period, spend_total, income_total FROM {ROLLUP_MV} "
            "WHERE household_id = :hh AND period >= :start AND period <= :end"
        ),
        {"hh": user.household_id, "start": _period_start(from_date, "monthly"), "end": _period_start(to_date, "monthly")},
    )).all()
    buckets = _empty_buckets()
    for period, spend_total, income_total in rows:
        key = _bucket_key(period, interval)
        buckets[key]["spend"] += _money(spend_total)
        buckets[key]["income"] += _money(income_total)
        buckets[key]["net"] = buckets[key]["income"] - buckets[key]["spend"]
    return buckets


def _bucket_key(value: date, interval: str) -> str:
    if interval == "yearly":
        return f"{value.year}"
    if interval == "quarterly":
        return f"{value.year}-Q{((value.month - 1) // 3) + 1}"
    return f"{value.year:04d}-{value.month:02d}"


async def list_budgets(session: AsyncSession, user: User) -> list[dict]:
    budgets = (await session.execute(scoped_query(Budget, user).order_by(Budget.period, Budget.amount.desc()))).scalars().all()
    out = []
    for budget in budgets:
        out.append(await _budget_out(session, user, budget))
    return out


async def create_budget(session: AsyncSession, user: User, data: BudgetIn) -> dict:
    if data.category_id:
        cat = await session.get(Category, data.category_id)
        if cat is None or cat.household_id not in (None, user.household_id):
            raise NotFound("Category not found")
    budget = Budget(
        household_id=user.household_id,
        category_id=data.category_id,
        period=data.period,
        amount=_money(data.amount),
        currency=data.currency.upper()[:3],
    )
    session.add(budget)
    await session.commit()
    await session.refresh(budget)
    return await _budget_out(session, user, budget)


async def update_budget(session: AsyncSession, user: User, budget_id: uuid.UUID, data: BudgetPatch) -> dict:
    budget = (await session.execute(scoped_query(Budget, user).where(Budget.id == budget_id))).scalar_one_or_none()
    if budget is None:
        raise NotFound("Budget not found")
    if data.category_id is not None:
        cat = await session.get(Category, data.category_id)
        if cat is None or cat.household_id not in (None, user.household_id):
            raise NotFound("Category not found")
        budget.category_id = data.category_id
    if data.period is not None:
        budget.period = data.period
    if data.amount is not None:
        budget.amount = _money(data.amount)
    if data.currency is not None:
        budget.currency = data.currency.upper()[:3]
    await session.commit()
    await session.refresh(budget)
    return await _budget_out(session, user, budget)


async def delete_budget(session: AsyncSession, user: User, budget_id: uuid.UUID) -> None:
    budget = (await session.execute(scoped_query(Budget, user).where(Budget.id == budget_id))).scalar_one_or_none()
    if budget is None:
        raise NotFound("Budget not found")
    await session.delete(budget)
    await session.commit()


async def _budget_out(session: AsyncSession, user: User, budget: Budget) -> dict:
    today = date.today()
    start = _period_start(today, budget.period)
    # Include draft AND confirmed transactions so budgets reflect real-time spending.
    txns = list((await session.execute(
        scoped_query(Transaction, user).where(
            Transaction.txn_date >= start,
            Transaction.txn_date <= today,
        )
    )).scalars().all())
    line_items = await _line_items(session, [t.id for t in txns])
    txn_category_ids = [t.category_id for t in txns if t.category_id]
    item_category_ids = [
        item.item_type_category_id
        for items in line_items.values()
        for item in items
        if item.item_type_category_id
    ]
    category_rows = await _categories_with_parents(session, [*txn_category_ids, *item_category_ids])
    category_scope = await _category_scope_ids(session, user, budget.category_id)
    spent = Decimal("0.00")
    for txn in txns:
        flags = txn.flags or {}
        if flags.get("transfer"):
            continue  # payment/transfer legs are money movement, not budget spend
        if _is_income_transaction(txn, category_rows):
            continue
        amount = _money(txn.base_amount if txn.base_amount is not None else txn.amount)
        # Refunds net the budget down (mirrors analytics._aggregate); a refund with
        # no line items applies its whole magnitude as a credit.
        sign = Decimal("-1") if flags.get("refund") else Decimal("1")
        if budget.category_id is None:
            spent += sign * abs(amount)
            continue
        txn_matches = txn.category_id in category_scope
        items = line_items.get(txn.id, [])
        if not items:
            if txn_matches:
                spent += sign * abs(amount)
            continue

        item_total = Decimal("0.00")
        for item in items:
            item_matches = item.item_type_category_id in category_scope if item.item_type_category_id else txn_matches
            if item_matches:
                item_total += abs(_money(item.amount))
        if item_total > 0:
            spent += sign * item_total
        elif txn_matches:
            spent += sign * abs(amount)
    spent = _money(max(spent, Decimal("0.00")))
    amount = _money(budget.amount)
    overspent = spent > amount
    if overspent:
        await _ensure_budget_notification(session, user, budget, spent)
    return {
        "id": budget.id,
        "household_id": budget.household_id,
        "category_id": budget.category_id,
        "period": budget.period,
        "amount": amount,
        "currency": budget.currency,
        "spent": spent,
        "remaining": _money(amount - spent),
        "progress_pct": _pct(spent, amount),
        "overspent": overspent,
    }


async def _ensure_budget_notification(session: AsyncSession, user: User, budget: Budget, spent: Decimal) -> None:
    await enqueue_notification(
        session,
        household_id=user.household_id,
        user_id=user.id,
        type="budget_overspend",
        payload={"budget_id": budget.id, "spent": spent, "amount": _money(budget.amount)},
        scheduled_for=datetime.now(timezone.utc),
        idempotency_key=f"budget_overspend:{budget.id}",
    )
    await session.commit()


async def recommendations(session: AsyncSession, user: User) -> list[Recommendation]:
    await _generate_recommendations(session, user)
    stmt = scoped_query(Recommendation, user).where(Recommendation.dismissed.is_(False)).order_by(Recommendation.generated_at.desc())
    return list((await session.execute(stmt)).scalars().all())


async def dismiss_recommendation(session: AsyncSession, user: User, recommendation_id: uuid.UUID) -> None:
    rec = (await session.execute(scoped_query(Recommendation, user).where(Recommendation.id == recommendation_id))).scalar_one_or_none()
    if rec is None:
        raise NotFound("Recommendation not found")
    rec.dismissed = True
    await session.commit()


async def _generate_recommendations(session: AsyncSession, user: User) -> None:
    today = date.today()
    current_start = _period_start(today, "monthly")
    previous_start = (current_start - timedelta(days=1)).replace(day=1)
    current = await _spend_by_category(session, user, current_start, today)
    previous = await _spend_by_category(session, user, previous_start, current_start - timedelta(days=1))
    for category_id, (amount, txn_ids) in current.items():
        prev_amount = previous.get(category_id, (Decimal("0.00"), []))[0]
        if amount >= Decimal("25.00") and (prev_amount == 0 or amount >= prev_amount * Decimal("1.4")):
            await _upsert_recommendation(
                session,
                user,
                "category_spike",
                {"message": "Spending is up versus the prior month; review the cited transactions before acting.", "amount": str(_money(amount)), "previous_amount": str(_money(prev_amount)), "category_id": str(category_id) if category_id else None},
                {"transaction_ids": [str(tid) for tid in txn_ids]},
            )
    await _duplicate_recommendations(session, user, current_start, today)
    await session.commit()


async def _spend_by_category(session: AsyncSession, user: User, from_date: date, to_date: date) -> dict[uuid.UUID | None, tuple[Decimal, list[uuid.UUID]]]:
    """Positive spend magnitude per category over the window, so the spike
    threshold (>= $25, up >= 40%) actually fires. Excludes transfers and income;
    nets refunds down — same rules as the spend aggregate."""
    txns = await _visible_transactions(session, user, from_date, to_date)
    category_rows = await _categories_with_parents(session, [t.category_id for t in txns if t.category_id])
    out: dict[uuid.UUID | None, tuple[Decimal, list[uuid.UUID]]] = {}
    for txn in txns:
        flags = txn.flags or {}
        if flags.get("transfer") or _is_income_transaction(txn, category_rows):
            continue
        amount = abs(_money(txn.base_amount if txn.base_amount is not None else txn.amount))
        if flags.get("refund"):
            amount = -amount
        prev, ids = out.get(txn.category_id, (Decimal("0.00"), []))
        out[txn.category_id] = (_money(prev + amount), [*ids, txn.id])
    return out


async def _duplicate_recommendations(session: AsyncSession, user: User, from_date: date, to_date: date) -> None:
    grouped: dict[tuple[uuid.UUID | None, Decimal, date], list[uuid.UUID]] = defaultdict(list)
    for txn in await _visible_transactions(session, user, from_date, to_date):
        grouped[(txn.merchant_id, _money(txn.base_amount or txn.amount), txn.txn_date)].append(txn.id)
    for (merchant_id, amount, txn_date), ids in grouped.items():
        if merchant_id and len(ids) > 1:
            await _upsert_recommendation(
                session,
                user,
                "duplicate_charge",
                {"message": "Possible duplicate charge detected; verify before disputing or deleting anything.", "amount": str(amount), "date": txn_date.isoformat(), "merchant_id": str(merchant_id)},
                {"transaction_ids": [str(tid) for tid in ids]},
            )


async def _upsert_recommendation(session: AsyncSession, user: User, rec_type: str, payload: dict, refs: dict) -> None:
    stmt = select(Recommendation).where(
        Recommendation.household_id == user.household_id,
        Recommendation.type == rec_type,
        Recommendation.supporting_refs == refs,
    )
    rec = (await session.execute(stmt)).scalar_one_or_none()
    if rec is None:
        session.add(
            Recommendation(
                household_id=user.household_id,
                user_id=user.id,
                type=rec_type,
                payload=payload,
                supporting_refs=refs,
                generated_at=datetime.now(timezone.utc),
                dismissed=False,
            )
        )


async def _visible_transactions(session: AsyncSession, user: User, from_date: date, to_date: date) -> list[Transaction]:
    stmt = scoped_query(Transaction, user).where(
        Transaction.status == "confirmed",
        Transaction.txn_date >= from_date,
        Transaction.txn_date <= to_date,
    )
    return list((await session.execute(stmt)).scalars().all())


async def _merchant_names(session: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    rows = (await session.execute(select(Merchant).where(Merchant.id.in_(ids)))).scalars().all()
    return {row.id: row.canonical_name for row in rows}


async def _category_names(session: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    rows = (await session.execute(select(Category).where(Category.id.in_(ids)))).scalars().all()
    return {row.id: row.name for row in rows}


async def _categories_with_parents(session: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, Category]:
    if not ids:
        return {}
    rows = list((await session.execute(select(Category).where(Category.id.in_(ids)))).scalars().all())
    parent_ids = [row.parent_id for row in rows if row.parent_id]
    if parent_ids:
        rows.extend((await session.execute(select(Category).where(Category.id.in_(parent_ids)))).scalars().all())
    return {row.id: row for row in rows}


async def _category_scope_ids(session: AsyncSession, user: User, category_id: uuid.UUID | None) -> set[uuid.UUID]:
    if category_id is None:
        return set()
    rows = list(
        (
            await session.execute(
                select(Category).where(
                    or_(Category.household_id.is_(None), Category.household_id == user.household_id)
                )
            )
        )
        .scalars()
        .all()
    )
    children: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for row in rows:
        if row.parent_id:
            children[row.parent_id].append(row.id)
    out = {category_id}
    stack = [category_id]
    while stack:
        current = stack.pop()
        for child_id in children.get(current, []):
            if child_id not in out:
                out.add(child_id)
                stack.append(child_id)
    return out


async def _line_items(session: AsyncSession, transaction_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[LineItem]]:
    if not transaction_ids:
        return {}
    rows = (await session.execute(select(LineItem).where(LineItem.transaction_id.in_(transaction_ids)))).scalars().all()
    out: dict[uuid.UUID, list[LineItem]] = defaultdict(list)
    for row in rows:
        out[row.transaction_id].append(row)
    return out


async def _transaction_tags(session: AsyncSession, transaction_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[str]]:
    if not transaction_ids:
        return {}
    rows = (await session.execute(
        select(TransactionTag.transaction_id, Tag.name).join(Tag, Tag.id == TransactionTag.tag_id).where(TransactionTag.transaction_id.in_(transaction_ids))
    )).all()
    out: dict[uuid.UUID, list[str]] = defaultdict(list)
    for txn_id, name in rows:
        out[txn_id].append(name)
    return out


async def _line_item_tags(session: AsyncSession, line_item_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[str]]:
    if not line_item_ids:
        return {}
    rows = (await session.execute(
        select(LineItemTag.line_item_id, Tag.name).join(Tag, Tag.id == LineItemTag.tag_id).where(LineItemTag.line_item_id.in_(line_item_ids))
    )).all()
    out: dict[uuid.UUID, list[str]] = defaultdict(list)
    for line_item_id, name in rows:
        out[line_item_id].append(name)
    return out


async def reset_m7_generated_data(session: AsyncSession, household_id: uuid.UUID) -> None:
    await session.execute(delete(Recommendation).where(Recommendation.household_id == household_id))
