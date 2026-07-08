from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst import debt_plan as dp
from app.analyst.conversation import append_turn, get_or_create_thread, recent_turns
from app.analyst.memory.assembler import assemble, has_memory, to_prompt
from app.analyst.memory.retrieve import recent_transaction_chunks
from app.analyst.schemas import (
    AggressionLevel,
    AnalystAction,
    AnalystActionResponse,
    AnalystAlert,
    AnalystAskIn,
    AnalystAskOut,
    AnalystThreadMessage,
    AnalystThreadOut,
    DebtPlanAlternative,
    DebtPlanLLM,
    DebtPlanMilestones,
    DebtPlanOut,
    DebtPlanPhase,
    DebtPlanReasoning,
    FinancialSnapshot,
    MemorySourceStatus,
    MemoryStatusOut,
    MonitorOut,
    PersistentAlert,
)
from app.analyst.snapshot import build_snapshot
from app.auth.deps import scoped_query
from app.cashflow.service import build_cashflow_summary
from app.fx import service as fx_service
from app.llm.errors import LLMError
from app.models.core import User
from app.models.debt import Loan, LoanPayment


async def run_reindex(session, user, llm) -> dict:
    from app.analyst.memory.reconcile import reconcile_household
    counts = await reconcile_household(session, user.household_id, llm)
    return {
        "documents": counts.get("document", 0),
        "transactions": counts["transaction"],
        "loans": counts["loan"],
        "recurring": counts["recurring"],
        "accounts": counts.get("account", 0),
        "account_balances": counts.get("account_balance", 0),
        "payment_methods": counts.get("payment_method", 0),
        "budgets": counts.get("budget", 0),
        "merchants": counts.get("merchant", 0),
        "categories": counts.get("category", 0),
        "tags": counts.get("tag", 0),
        "rules": counts.get("rule", 0),
        "income_sources": counts.get("income_source", 0),
        "investment_holdings": counts.get("investment_holding", 0),
        "holding_valuations": counts.get("holding_valuation", 0),
    }


async def memory_status(session, user) -> MemoryStatusOut:
    from app.models.memory import MemoryChunk
    rows = (await session.execute(
        select(MemoryChunk.source_type, func.count(), func.max(MemoryChunk.created_at))
        .where(MemoryChunk.household_id == user.household_id)
        .group_by(MemoryChunk.source_type)
    )).all()
    sources = [
        MemorySourceStatus(source_type=st, count=count, last_indexed=last)
        for st, count, last in rows
    ]
    last_synced = max((s.last_indexed for s in sources if s.last_indexed), default=None)
    return MemoryStatusOut(sources=sources, last_synced=last_synced)


def derive_alerts(snapshot: FinancialSnapshot) -> list[AnalystAlert]:
    alerts: list[AnalystAlert] = []
    for budget in snapshot.budget_overages:
        alerts.append(
            AnalystAlert(
                id=f"budget:{budget.get('category_id')}",
                kind="budget_overspend",
                severity=9,
                tone="danger",
                title=f"{budget.get('name', 'A budget')} is over",
                detail=(
                    f"Over by {_format_amount(Decimal(budget.get('over', 0)), snapshot.currency)} "
                    f"({budget.get('pct', 0):.0f}% of limit)."
                ),
                suggested_action=AnalystAction(
                    type="set_budget",
                    label=f"Adjust {budget.get('name', 'budget')}",
                    params={"category_id": budget.get("category_id")},
                ),
            )
        )
    if snapshot.net < 0:
        alerts.append(
            AnalystAlert(
                id="cashflow:negative",
                kind="negative_cashflow",
                severity=8,
                tone="warning",
                title="Cash flow is negative",
                detail=f"Spending exceeds income by {_format_amount(Decimal(abs(snapshot.net)), snapshot.currency)} this period.",
                suggested_action=AnalystAction(
                    type="focus_widget", label="View cashflow", params={"widget": "cashflow"}
                ),
            )
        )
    for budget in snapshot.near_limit_budgets:
        alerts.append(
            AnalystAlert(
                id=f"budget-near:{budget.get('category_id')}",
                kind="budget_near_limit",
                severity=5,
                tone="info",
                title=f"{budget.get('name', 'A budget')} near its limit",
                detail=f"{budget.get('pct', 0):.0f}% of the limit used.",
            )
        )
    for recommendation in snapshot.recommendations:
        alerts.append(
            AnalystAlert(
                id=f"rec:{recommendation.get('id')}",
                kind=str(recommendation.get("type", "recommendation")),
                severity=6,
                tone="info",
                title="Heads up",
                detail=str(recommendation.get("message") or "Review this recommendation."),
            )
        )
    if not alerts:
        alerts.append(
            AnalystAlert(
                id="all-clear",
                kind="all_clear",
                severity=1,
                tone="positive",
                title="All clear",
                detail="Nothing needs your attention right now.",
            )
        )
    return sorted(alerts, key=lambda alert: alert.severity, reverse=True)


_SYSTEM = {
    "explain": (
        "You are a personal-finance analyst. EXPLAIN the user's metrics using only the provided "
        "financial snapshot. Be concise and answer only what was asked."
    ),
    "plan": (
        "You are a personal-finance analyst in PLAN mode. Produce a short, actionable plan using "
        "only the provided financial snapshot and prefer concrete steps with real numbers."
    ),
    "action": (
        "You are a personal-finance analyst in ACTION mode. Answer briefly, then propose actions "
        "the user can confirm using only the action types in the supplied response schema."
    ),
}

_GROUNDING_RULES = (
    "The snapshot's income, expenses, and net are totals for period_from through period_to, "
    "inclusive. They are not annual figures. Do not annualize, monthly-average, extrapolate, or "
    "infer causes or account composition unless the user explicitly asks and the snapshot supports "
    "it. Assets, liabilities, and net worth are point-in-time values. Never invent numbers. "
    "Use plain text without Markdown markers."
    " If the snapshot and the provided records and facts do not contain the answer, say you don't"
    " have that information rather than guessing."
    " The snapshot's holdings and income_sources arrays list the user's investment holdings and"
    " income sources; when asked about stocks, investments, or income you may list and break them"
    " down from those arrays, but never invent values not present there."
)

_GREETINGS = frozenset({"hi", "hello", "hey", "hiya", "howdy"})


def _asks_for_recent_transactions(question: str) -> bool:
    normalized = " ".join(question.lower().replace("-", " ").split())
    return "recent" in normalized and (
        "transaction" in normalized
        or "transactions" in normalized
        or "purchase" in normalized
        or "purchases" in normalized
        or "spend" in normalized
        or "spending" in normalized
    )


async def _persist_turn_if_needed(
    session: AsyncSession, user: User, thread_id: str | None, question: str, answer: str
) -> str | None:
    if not thread_id:
        return None
    try:
        thread_row = await get_or_create_thread(session, user, thread_id)
        await append_turn(session, thread_row.id, question=question, answer=answer)
        return thread_id
    except Exception:
        return None


async def _answer_recent_transactions(
    session: AsyncSession, user: User, data: AnalystAskIn, limit: int = 8
) -> AnalystAskOut:
    chunks = await recent_transaction_chunks(session, user, limit=limit)
    citations = [
        {"source_type": chunk.source_type, "source_id": str(chunk.source_id)}
        for chunk in chunks
    ]
    if not chunks:
        answer = "I don't have recent transaction records available yet."
    else:
        lines = [f"{idx}. {chunk.text}" for idx, chunk in enumerate(chunks, start=1)]
        answer = "Your recent transactions are:\n" + "\n".join(lines)
    out_thread = await _persist_turn_if_needed(session, user, data.thread_id, data.question, answer)
    return AnalystAskOut(answer=answer, citations=citations, thread_id=out_thread)


def build_messages(
    mode: str, snapshot: FinancialSnapshot, question: str, focus: dict | None = None,
    page: str | None = None,
) -> list[dict]:
    user_content = f"Question: {question}\n\nFinancial snapshot (JSON):\n{snapshot.model_dump_json()}"
    if page:
        user_content += f"\n\nThe user is currently on the {page} page of the app."
    if focus:
        delta = "" if focus.get("delta_pct") is None else f" ({focus['delta_pct']:+.0f}% vs the previous period)"
        user_content += (
            f"\n\nThe user is currently viewing the {focus['kind']} '{focus['label']}'. "
            f"Answer about it specifically. It spent {focus.get('spend', 0):.2f} this period{delta}; "
            f"previous period {focus.get('prev_spend', 0):.2f}."
        )
    return [
        {
            "role": "system",
            "content": f'{_SYSTEM.get(mode, _SYSTEM["explain"])} {_GROUNDING_RULES}',
        },
        {"role": "user", "content": user_content},
    ]


async def build_focus_summary(
    session, user, focus_kind: str, focus_label: str, from_date, to_date
) -> dict | None:
    """Best-effort spend summary for the entity the user is viewing, so the
    analyst can answer about it specifically. Reuses the analytics breakdown
    (which resolves merchant_id → name and rolls categories), filtered to the
    focus label, for the current and previous equal-length windows."""
    from datetime import timedelta

    from app.analytics import service as analytics

    if not focus_label:
        return None
    dim = "merchant" if focus_kind == "merchant" else "category"
    cur = await analytics.breakdown(session, user, dim, focus_label, from_date, to_date)
    days = (to_date - from_date).days + 1
    prev_to = from_date - timedelta(days=1)
    prev_from = prev_to - timedelta(days=days - 1)
    prev = await analytics.breakdown(session, user, dim, focus_label, prev_from, prev_to)

    def _sum(rows: dict) -> float:
        return sum(float(r.get("total") or 0) for r in (rows.get("rows") or []))

    spend = _sum(cur)
    prev_spend = _sum(prev)
    delta_pct = ((spend - prev_spend) / prev_spend * 100) if prev_spend else None
    return {"kind": focus_kind, "label": focus_label, "spend": spend, "prev_spend": prev_spend, "delta_pct": delta_pct}


_UNAVAILABLE = (
    "The AI analyst is unavailable right now. Configure an AI provider to enable Explain, Plan, and Action."
)


async def run_monitor(
    session: AsyncSession, user: User, from_date: date, to_date: date
) -> MonitorOut:
    from app.analyst.insight.engine import list_alerts
    from app.analyst.insight.scan import run_alert_scan
    try:
        # Cheap deterministic-only refresh keeps the feed correct even if the
        # scheduled job has not run; LLM insights come from the background scan.
        await run_alert_scan(session, user, llm=None, from_date=from_date, to_date=to_date,
                             llm_insights=False, notify=False)
    except Exception:  # the optional analyst must never 5xx the monitor feed
        pass
    rows = await list_alerts(session, user)
    return MonitorOut(alerts=[_to_persistent(row) for row in rows])


def _to_persistent(row) -> PersistentAlert:
    action = AnalystAction(**row.suggested_action) if row.suggested_action else None
    return PersistentAlert(
        id=str(row.id), kind=row.kind, severity=row.severity, tone=row.tone,
        state=row.state, title=row.title, detail=row.detail, suggested_action=action,
        supporting_refs=row.supporting_refs or [],
        acknowledged_at=row.acknowledged_at, resolved_at=row.resolved_at,
    )


async def run_acknowledge(session, user, alert_id):
    from app.analyst.insight.engine import acknowledge_alert
    row = await acknowledge_alert(session, user, alert_id)
    return _to_persistent(row) if row is not None else None


async def run_scan_alerts(session, user, llm) -> dict:
    from app.analyst.insight.scan import run_alert_scan
    return await run_alert_scan(session, user, llm, llm_insights=True, notify=True)


async def run_thread_history(
    session: AsyncSession, user: User, key: str, limit: int = 50
) -> AnalystThreadOut:
    thread = await get_or_create_thread(session, user, key)
    turns = await recent_turns(session, thread.id, limit=limit)
    return AnalystThreadOut(
        messages=[AnalystThreadMessage(role=turn.role, text=turn.text) for turn in turns]
    )


async def run_ask(session: AsyncSession, user: User, data: AnalystAskIn, llm) -> AnalystAskOut:
    if data.question.strip().lower().rstrip("!.,?") in _GREETINGS:
        return AnalystAskOut(
            answer="Hi — ask me about your spending, cash flow, budgets, or financial plan."
        )
    frm, to = _resolve_from(data), _resolve_to(data)
    if _asks_for_recent_transactions(data.question):
        return await _answer_recent_transactions(session, user, data)
    ctx = await assemble(
        session,
        user,
        data.question,
        llm,
        frm,
        to,
        page=data.page,
        page_context=data.page_context.model_dump() if data.page_context else None,
    )
    user_content = f"Question: {data.question}\n\n{to_prompt(ctx)}"
    if data.focus_kind and data.focus_label:
        try:
            focus = await build_focus_summary(session, user, data.focus_kind, data.focus_label, frm, to)
            if focus:
                delta = "" if focus.get("delta_pct") is None else f" ({focus['delta_pct']:+.0f}% vs the previous period)"
                user_content += (
                    f"\n\nThe user is currently viewing the {focus['kind']} '{focus['label']}'. "
                    f"Answer about it specifically. It spent {focus.get('spend', 0):.2f} this period{delta}."
                )
        except Exception:
            pass  # focus is best-effort; never block the answer

    thread_row = None
    if data.thread_id:
        try:
            thread_row = await get_or_create_thread(session, user, data.thread_id)
            history = await recent_turns(session, thread_row.id)
            if history:
                convo = "\n".join(
                    f"{'User' if turn.role == 'user' else 'Analyst'}: {turn.text}"
                    for turn in history
                )
                user_content = f"Conversation so far:\n{convo}\n\n{user_content}"
        except Exception:
            thread_row = None

    messages = [
        {"role": "system", "content": f'{_SYSTEM.get(data.mode, _SYSTEM["explain"])} {_GROUNDING_RULES}'},
        {"role": "user", "content": user_content},
    ]
    citations = [{"source_type": c["source_type"], "source_id": c["source_id"]} for c in ctx.chunks]
    out_thread = data.thread_id if thread_row is not None else None
    try:
        if data.mode == "action":
            result = await llm.chat(
                messages,
                json_schema=AnalystActionResponse,
                purpose="analyst.ask",
                user_id=user.id,
                session=session,
            )
            parsed = AnalystActionResponse(**result)
            answer = parsed.answer
            out = AnalystAskOut(
                answer=answer,
                suggestions=parsed.actions,
                citations=citations,
                thread_id=out_thread,
            )
        else:
            result = await llm.chat(
                messages, purpose="analyst.ask", user_id=user.id, session=session
            )
            answer = result.get("content") or _UNAVAILABLE
            out = AnalystAskOut(answer=answer, citations=citations, thread_id=out_thread)
    except LLMError:
        return AnalystAskOut(answer=_UNAVAILABLE, suggestions=[], available=False)
    except Exception:  # The optional analyst must never turn a provider response into a 5xx.
        return AnalystAskOut(answer=_UNAVAILABLE, suggestions=[], available=False)

    if thread_row is not None:
        try:
            await append_turn(session, thread_row.id, question=data.question, answer=answer)
        except Exception:
            pass
    return out


def _resolve_from(data: AnalystAskIn) -> date:
    return date.fromisoformat(data.range_from) if data.range_from else _default_from()


def _resolve_to(data: AnalystAskIn) -> date:
    return date.fromisoformat(data.range_to) if data.range_to else date.today()


def _default_from() -> date:
    today = date.today()
    month = today.month - 3
    year = today.year + (month - 1) // 12
    return date(year, (month - 1) % 12 + 1, 1)


_DEBT_SYSTEM = (
    "You are a personal-finance debt coach. You are given the user's loans, their monthly "
    "budget (income, expenses, leftover, and affordable_extra), and two precomputed payoff "
    "scenarios (snowball and avalanche). Decide which strategy best fits this user and a "
    "sensible extra monthly payment. Your recommended extra_monthly MUST NOT exceed "
    "affordable_extra — never suggest paying more than the household can afford. Return ONLY "
    "the JSON fields requested. Do NOT compute or state any totals, savings, dates, or month "
    "counts — those are calculated for you. headline is one short sentence; narrative is 2-3 "
    "sentences of plain-text coaching. Never use Markdown."
)

_AGGRESSION_LABELS: dict[AggressionLevel, str] = {
    "comfortable": "Comfortable Plan",
    "balanced": "Balanced Plan",
    "aggressive": "Aggressive Plan",
    "asap": "Debt Freedom ASAP",
}

_AGGRESSION_SHARE: dict[AggressionLevel, Decimal] = {
    "comfortable": Decimal("0.25"),
    "balanced": Decimal("0.50"),
    "aggressive": Decimal("0.75"),
    "asap": Decimal("0.95"),
}

_AGGRESSION_BEST_FOR: dict[AggressionLevel, str] = {
    "comfortable": "Users who want progress while preserving the most lifestyle and cash flexibility.",
    "balanced": "Users who want debt payoff, savings, investing, and breathing room to move together.",
    "aggressive": "Users with stable cash flow who can push debt hard while keeping an emergency buffer.",
    "asap": "Users who want the fastest payoff and accept very limited discretionary flexibility.",
}


async def _debt_loans(session, user) -> list[Loan]:
    # Credit cards live on their own Cards page and are excluded from the Debt
    # page; keep the debt plan consistent with what the Debt UI actually shows.
    loans = list((await session.execute(scoped_query(Loan, user))).scalars().all())
    loans = [loan for loan in loans if loan.type != "credit_card"]
    await _attach_outstanding(session, loans)
    return loans


async def _attach_outstanding(session, loans: list[Loan]) -> None:
    # Plan from what's still owed (principal minus recorded principal payments),
    # matching the frontend, which projects from outstanding_balance. The engine
    # reads this attribute and falls back to principal when it's absent.
    #
    # The waterfall sums balances across loans, so a mixed-currency plan must be in
    # one currency: convert outstanding + minimum to the household base and attach
    # them (outstanding_balance / min_amount_base). The engine reads those; interest
    # rates are currency-independent and pass through unchanged.
    if not loans:
        return
    base = await fx_service.household_base_currency(session, loans[0].household_id)
    today = date.today()
    for loan in loans:
        rows = (
            await session.execute(
                select(LoanPayment.principal_component).where(LoanPayment.loan_id == loan.id)
            )
        ).scalars().all()
        paid = sum((Decimal(str(r or 0)) for r in rows), Decimal("0"))
        outstanding = max(Decimal("0.00"), Decimal(str(loan.principal)) - paid)
        loan.outstanding_balance = await _to_base(session, outstanding, loan.currency, base, today)
        if loan.min_or_emi_amount is not None:
            loan.min_amount_base = await _to_base(session, loan.min_or_emi_amount, loan.currency, base, today)


async def _to_base(session, amount: Decimal, currency: str | None, base: str, as_of: date) -> Decimal:
    # Convert to the household base currency, degrading to the raw magnitude when no
    # rate is on file so a missing FX pair never drops a loan from the plan.
    try:
        converted, _rate, _rate_date = await fx_service.convert(session, amount, currency or base, base, as_of)
        return Decimal(str(converted))
    except fx_service.FXRateUnavailable:
        return Decimal(str(amount))


def _clamp_extra(value) -> Decimal:
    # Floor at zero only — there is no upper cap on the extra payment; the
    # recommendation is bounded by what the household can afford (leftover), not an
    # arbitrary ceiling.
    try:
        amount = Decimal(str(value))
    except Exception:
        amount = Decimal("0")
    if amount < 0:
        amount = Decimal("0")
    return amount.quantize(Decimal("0.01"))


def _default_extra(loans: list[Loan]) -> Decimal:
    total_min = sum((Decimal(str(loan.min_or_emi_amount or 0)) for loan in loans), Decimal("0"))
    return _clamp_extra(total_min * Decimal("0.1"))


def _affordable_default_extra(leftover: Decimal) -> Decimal:
    if leftover <= 0:
        return Decimal("0.00")
    return _clamp_extra(leftover * Decimal("0.5"))


def _extra_for_aggression(leftover: Decimal, aggression: AggressionLevel) -> Decimal:
    if leftover <= 0:
        return Decimal("0.00")
    return _clamp_extra(leftover * _AGGRESSION_SHARE[aggression])


_CURRENCY_SYMBOLS: dict[str, str] = {
    "USD": "$", "EUR": "€", "GBP": "£", "JPY": "¥", "INR": "₹",
    "CAD": "CA$", "AUD": "A$", "NZD": "NZ$", "SGD": "S$", "HKD": "HK$",
    "BRL": "R$", "CHF": "CHF", "KRW": "₩", "CNY": "¥", "MXN": "MX$",
    "RUB": "₽", "TRY": "₺", "NGN": "₦", "PHP": "₱", "THB": "฿",
}


def _currency_symbol(code: str) -> str:
    """Return a human-friendly currency symbol for narration."""
    return _CURRENCY_SYMBOLS.get(code.upper(), code)


def _format_amount(amount: Decimal, currency: str) -> str:
    """Format an amount with its currency symbol for narration, e.g. '$500' or '₹500'."""
    sym = _currency_symbol(currency)
    if currency.upper() in ("JPY", "KRW"):
        return f"{sym}{amount:,.0f}"
    return f"{sym}{amount:,.2f}"


def _aggression_explanation(aggression: AggressionLevel, extra: Decimal, leftover: Decimal, currency: str) -> str:
    remaining = _clamp_extra(max(Decimal("0"), leftover - extra))
    label = _AGGRESSION_LABELS[aggression]
    rem_str = _format_amount(remaining, currency)
    if aggression == "comfortable":
        return f"{label} uses a modest share of leftover cash so the user keeps {rem_str}/mo for reserves, bills, and flexibility."
    if aggression == "balanced":
        return f"{label} directs about half of leftover cash to debt and leaves {rem_str}/mo for savings, investing, irregular expenses, and flexibility."
    if aggression == "aggressive":
        return f"{label} sends most leftover cash to debt while preserving {rem_str}/mo as a practical monthly buffer."
    return f"{label} maximizes payoff after obligations, leaving only {rem_str}/mo from current leftover cash for essential reserves and irregular expenses."


def _default_strategy(loans: list[Loan]) -> str:
    return "avalanche" if any(loan.interest_rate is not None for loan in loans) else "snowball"


def _deterministic_extra(loans: list[Loan], leftover: Decimal) -> Decimal:
    extra = _affordable_default_extra(leftover)
    if extra <= 0:
        extra = _default_extra(loans)  # fall back when no surplus signal
    return extra


def _confidence(loans: list[Loan], leftover: Decimal, extra: Decimal) -> str:
    if leftover <= 0 or extra <= 0:
        return "Low"
    if any(loan.interest_rate is None or loan.min_or_emi_amount is None for loan in loans):
        return "Medium"
    if len({loan.currency for loan in loans if loan.currency}) > 1:
        return "Medium"
    return "High"


def _assemble_plan(
    loans, *, strategy, extra, source, headline, narrative, currency,
    affordable_extra: Decimal = Decimal("0.00"),
    income: Decimal = Decimal("0.00"),
    expenses: Decimal = Decimal("0.00"),
    leftover: Decimal = Decimal("0.00"),
    aggression_level: AggressionLevel | None = None,
) -> DebtPlanOut:
    extra = _clamp_extra(extra)
    base = dp.project_total(loans, Decimal("0"), strategy)
    opt_sim = dp.simulate_strategy(loans, extra, strategy)
    opt = {"months": opt_sim["months"], "interest": opt_sim["interest"], "payoff_date": opt_sim["payoff_date"]}
    interest_saved = max(Decimal("0.00"), base["interest"] - opt["interest"])
    months_sooner = max(0, base["months"] - opt["months"])
    ordered = dp.build_ordered(loans, extra, strategy)
    top = ordered[0] if ordered else None
    timeline = [row for row in opt_sim.get("timeline", []) if row.get("clear_month")]
    timeline.sort(key=lambda row: row["clear_month"])
    first_month = timeline[0]["clear_month"] if timeline else None
    next_month = timeline[1]["clear_month"] if len(timeline) > 1 else None
    cash_remaining = _clamp_extra(max(Decimal("0"), leftover - extra))
    milestones = DebtPlanMilestones(
        first_loan_paid_off_months=first_month,
        next_loan_paid_off_months=next_month,
        payoff_accelerated_months=months_sooner,
        estimated_interest_saved=interest_saved,
        monthly_cash_still_left=cash_remaining,
        confidence_level=_confidence(loans, leftover, extra),
    )
    phases = _build_phases(loans, ordered, opt_sim)
    reasoning = _build_reasoning(
        loans, ordered, strategy=strategy, extra=extra, leftover=leftover,
        aggression_level=aggression_level, currency=currency,
    )
    alternatives = _build_alternatives(loans, strategy, leftover)
    recommendation_name = _AGGRESSION_LABELS.get(aggression_level, "AI Debt Payoff Plan")
    final = (
        f"Start with an extra {_format_amount(extra, currency)}/month toward {top.name}. "
        "Keep every other debt on minimum payment. Recalculate after this loan is paid off."
        if top else ""
    )
    return DebtPlanOut(
        available=source == "ai",
        source=source,
        strategy=strategy,
        aggression_level=aggression_level,
        recommendation_name=recommendation_name,
        extra_monthly=extra,
        affordable_extra=_clamp_extra(max(affordable_extra, Decimal("0"))),
        headline=headline,
        narrative=narrative,
        ordered=ordered,
        milestones=milestones,
        phases=phases,
        reasoning=reasoning,
        alternatives=alternatives,
        final_recommendation=final,
        currency=currency,
        interest_saved=interest_saved,
        months_sooner=months_sooner,
        baseline_payoff_date=base["payoff_date"],
        optimized_payoff_date=opt["payoff_date"],
        updated_at=datetime.now(timezone.utc),
    )


def _build_phases(loans: list[Loan], ordered, sim: dict) -> list[DebtPlanPhase]:
    by_id = {loan.id: loan for loan in loans}
    rows = sorted(
        [row for row in sim.get("timeline", []) if row.get("extra_start_month") or row.get("clear_month")],
        key=lambda row: (
            row.get("extra_start_month") or 9999,
            row.get("clear_month") or 9999,
        ),
    )
    ordered_by_id = {item.loan_id: item for item in ordered}
    phases: list[DebtPlanPhase] = []
    for idx, row in enumerate(rows, start=1):
        loan = by_id.get(row["loan_id"])
        item = ordered_by_id.get(row["loan_id"])
        if loan is None or item is None:
            continue
        start = row.get("extra_start_month") or 1
        clear = row.get("clear_month") or 0
        next_name = rows[idx]["loan_id"] if idx < len(rows) else None
        next_loan = by_id.get(next_name) if next_name is not None else None
        phases.append(
            DebtPlanPhase(
                phase=f"Phase {idx}: months {start}-{clear}" if clear else f"Phase {idx}: month {start}+",
                action=f"Pay minimums on every debt; direct the extra-payment pool to {loan.name}.",
                extra_payment_target=loan.name,
                expected_result=(
                    f"{loan.name} is projected to be paid off in month {clear}."
                    if clear else f"{loan.name} is not projected to clear inside the current horizon."
                ),
                roll_payments=(
                    f"After payoff, roll {loan.name}'s minimum into {next_loan.name}."
                    if next_loan else "After payoff, keep the freed cash for savings, investing, or the next financial goal."
                ),
            )
        )
    return phases


def _build_reasoning(
    loans: list[Loan],
    ordered,
    *,
    strategy: str,
    extra: Decimal,
    leftover: Decimal,
    aggression_level: AggressionLevel | None,
    currency: str,
) -> DebtPlanReasoning:
    top = ordered[0] if ordered else None
    low_rate = [loan for loan in loans if dp._rate(loan.interest_rate) < Decimal("0.06")]
    investing_note = (
        "For loans below roughly 6% APR, long-term investing may compete with accelerated payoff after higher-rate debts are gone."
        if low_rate else
        "Because the priority debts carry meaningful interest, payoff is likely the cleaner use of extra cash before adding riskier investing."
    )
    risk_notes = [
        "Minimum payments must stay current on every loan.",
        "Irregular expenses can break the plan if the remaining cash buffer is too thin.",
    ]
    if aggression_level == "asap":
        risk_notes.append("Debt Freedom ASAP leaves little room for surprise bills; pause extra payments before using emergency reserves.")
    return DebtPlanReasoning(
        why_this_loan_first=(
            f"{top.name} comes first because {top.priority_reason or top.rationale}"
            if top else "No active loan is available to prioritize."
        ),
        why_this_extra_amount=(
            _aggression_explanation(aggression_level, extra, leftover, currency)
            if aggression_level else
            f"The AI-selected extra payment is capped by available leftover cash, leaving {_format_amount(max(Decimal('0'), leftover - extra).quantize(Decimal('0.01')), currency)}/mo unassigned."
        ),
        tradeoff=(
            f"This plan trades {_format_amount(extra, currency)}/mo of current flexibility for faster debt freedom and lower interest."
        ),
        investing_note=investing_note,
        risk_notes=risk_notes,
    )


def _build_alternatives(loans: list[Loan], strategy: str, leftover: Decimal) -> list[DebtPlanAlternative]:
    base = dp.project_total(loans, Decimal("0"), strategy)
    alternatives: list[DebtPlanAlternative] = []
    for level in ("comfortable", "balanced", "aggressive", "asap"):
        aggression = level  # type: ignore[assignment]
        extra = _extra_for_aggression(leftover, aggression)
        opt = dp.project_total(loans, extra, strategy)
        alternatives.append(
            DebtPlanAlternative(
                aggression_level=aggression,
                label=_AGGRESSION_LABELS[aggression],
                extra_payoff_amount=extra,
                estimated_payoff_improvement_months=max(0, base["months"] - opt["months"]),
                interest_saved=max(Decimal("0.00"), base["interest"] - opt["interest"]),
                best_for=_AGGRESSION_BEST_FOR[aggression],
            )
        )
    return alternatives


def _plan_fingerprint(
    user, loans: list[Loan], income: Decimal, leftover: Decimal,
    aggression_level: AggressionLevel | None,
) -> str:
    # Anything that would change the plan goes in the fingerprint: the loans
    # (balance/rate/minimum/outstanding/type) and the budget. A change flips the
    # key, forcing a recompute; the cache TTL handles "nothing changed for a while".
    # The calendar day is included so payoff dates roll forward daily even when no
    # input changes.
    parts = {
        "hh": str(getattr(user, "household_id", "") or ""),
        "day": date.today().isoformat(),
        "income": str(income),
        "leftover": str(leftover),
        "aggression_level": aggression_level or "legacy-ai",
        "loans": sorted(
            [
                str(loan.id),
                str(loan.principal),
                str(loan.interest_rate),
                str(loan.min_or_emi_amount),
                str(dp._outstanding(loan)),
                str(loan.type),
            ]
            for loan in loans
        ),
    }
    blob = json.dumps(parts, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


async def run_debt_plan(
    session, user, llm, *, force: bool = False,
    aggression_level: AggressionLevel | None = None,
) -> DebtPlanOut:
    loans = await _debt_loans(session, user)
    if not loans:
        return DebtPlanOut(
            available=True, source="deterministic", strategy="avalanche",
            aggression_level=aggression_level,
            extra_monthly=Decimal("0.00"), headline="No debts to plan yet.", narrative="",
            ordered=[], currency=getattr(loans[0], "currency", "USD") if loans else "USD",
            interest_saved=Decimal("0.00"), months_sooner=0,
            baseline_payoff_date=None, optimized_payoff_date=None,
            updated_at=datetime.now(timezone.utc),
        )
    currency = loans[0].currency or "USD"
    income = Decimal("0")
    expenses = Decimal("0")
    try:
        cashflow = await build_cashflow_summary(session, user)
        leftover = cashflow.leftover_monthly
        income = cashflow.income_monthly
        expenses = max(Decimal("0"), income - leftover)
    except Exception:  # affordability is advisory; never break the plan over it
        leftover = Decimal("0")
    affordable = max(leftover, Decimal("0"))

    # Serve a cached plan unless an input changed (fingerprint) or the entry aged
    # out (TTL) — so a page refresh doesn't recompute, or re-hit the LLM, for free.
    cache = getattr(llm, "cache", None)
    cache_key = f"debtplan:{_plan_fingerprint(user, loans, income, leftover, aggression_level)}"
    if cache is not None and not force:  # force=manual recalc -> skip the read, recompute
        cached = await cache.get(cache_key)
        if cached is not None:
            try:
                return DebtPlanOut(**cached)
            except Exception:  # corrupt/old shape — fall through and recompute
                pass

    out = await _compute_debt_plan(
        session, user, llm, loans,
        currency=currency, income=income, expenses=expenses,
        leftover=leftover, affordable=affordable, aggression_level=aggression_level,
    )
    if cache is not None:
        try:
            await cache.set(cache_key, out.model_dump(mode="json"))
        except Exception:  # caching is best-effort, never fatal
            pass
    return out


async def _compute_debt_plan(
    session, user, llm, loans, *, currency, income, expenses, leftover, affordable,
    aggression_level: AggressionLevel | None = None,
) -> DebtPlanOut:
    strategy = _default_strategy(loans)
    if aggression_level is not None:
        extra = _extra_for_aggression(affordable, aggression_level)
        top = dp.order_loans(loans, strategy)[0]
        return _assemble_plan(
            loans, strategy=strategy, extra=extra, source="ai",
            headline=f"{_AGGRESSION_LABELS[aggression_level]}: pay {top.name} first.",
            narrative=_aggression_explanation(aggression_level, extra, leftover, currency),
            currency=currency, affordable_extra=affordable,
            income=income, expenses=expenses, leftover=leftover,
            aggression_level=aggression_level,
        )
    snapshot = {
        "loans": [
            {"name": loan.name, "type": loan.type, "schedule_kind": loan.schedule_kind,
             "outstanding": float(dp._outstanding(loan)),
             "principal": float(loan.principal), "interest_rate": (None if loan.interest_rate is None else float(loan.interest_rate)),
             "monthly": (None if loan.min_or_emi_amount is None else float(loan.min_or_emi_amount))}
            for loan in loans
        ],
        # Income context so the coach reasons within budget rather than guessing a
        # number that only gets clamped afterward.
        "budget": {
            "income_monthly": float(income),
            "expenses_monthly": float(expenses),
            "leftover_monthly": float(leftover),
            "affordable_extra": float(affordable),
        },
        "scenarios": {
            s: {
                "order": [loan.name for loan in dp.order_loans(loans, s)],
                "baseline": dp.project_total(loans, Decimal("0"), s),
                "with_extra_100": dp.project_total(loans, Decimal("100"), s),
            }
            for s in ("snowball", "avalanche")
        },
    }
    messages = [
        {"role": "system", "content": _DEBT_SYSTEM},
        {"role": "user", "content": f"Loans, budget, and precomputed scenarios (JSON):\n{snapshot}"},
    ]
    try:
        result = await llm.chat(messages, json_schema=DebtPlanLLM, purpose="analyst.debt_plan",
                                user_id=user.id, session=session)
        parsed = DebtPlanLLM(**result)
        # Cap the AI's suggestion at what the household can afford. When
        # affordability is unknown or zero, fall back to the deterministic default
        # so a hallucinated number can never pass through unbounded.
        cap = _clamp_extra(affordable) if affordable > 0 else _deterministic_extra(loans, leftover)
        extra = min(_clamp_extra(parsed.extra_monthly), cap)
        return _assemble_plan(
            loans, strategy=parsed.strategy, extra=extra, source="ai",
            headline=parsed.headline, narrative=parsed.narrative, currency=currency,
            affordable_extra=affordable, income=income, expenses=expenses, leftover=leftover,
        )
    except LLMError:
        pass
    except Exception:  # never 5xx from the optional analyst
        pass
    extra = _deterministic_extra(loans, leftover)
    return _assemble_plan(
        loans, strategy=strategy, extra=extra, source="deterministic",
        headline=f"Pay {dp.order_loans(loans, strategy)[0].name} first — {dp._REASON[strategy]}.",
        narrative="", currency=currency, affordable_extra=max(leftover, Decimal("0")),
        income=income, expenses=expenses, leftover=leftover,
    )
