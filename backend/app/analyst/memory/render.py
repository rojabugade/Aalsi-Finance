"""Render structured rows to short, grounded sentences for embedding, and
split long document text into embeddable chunks."""

from __future__ import annotations


def _money(amount, currency) -> str:
    try:
        return f"{float(amount):.2f} {currency or ''}".strip()
    except (TypeError, ValueError):
        return f"{amount} {currency or ''}".strip()


def render_transaction(txn, *, merchant: str | None = None, category: str | None = None) -> str:
    where = merchant or getattr(txn, "name", None) or "an unknown payee"
    cat = f" ({category})" if category else ""
    note = f" Note: {txn.notes}" if getattr(txn, "notes", None) else ""
    return f"On {txn.txn_date}, spent {_money(txn.amount, txn.currency)} at {where}{cat}.{note}"


def render_loan(loan) -> str:
    rate = "" if getattr(loan, "interest_rate", None) is None else f" at {float(loan.interest_rate):.2f}% APR"
    return (f"Loan '{getattr(loan, 'name', 'loan')}' ({getattr(loan, 'type', 'loan')}), "
            f"principal {_money(getattr(loan, 'principal', 0), getattr(loan, 'currency', ''))}{rate}.")


def render_recurring(series) -> str:
    return (f"Recurring '{getattr(series, 'name', 'item')}' "
            f"{_money(getattr(series, 'amount', 0), getattr(series, 'currency', ''))} "
            f"per {getattr(series, 'cadence', 'period')}.")


def render_account(account) -> str:
    shared = "shared" if getattr(account, "is_shared", False) else "personal"
    mask = getattr(account, "mask", None)
    suffix = f" ending in {mask}" if mask else ""
    return (
        f"Account '{getattr(account, 'label', 'account')}' is a {shared} "
        f"{getattr(account, 'type', 'account')} account in {getattr(account, 'currency', '')}{suffix}."
    )


def render_account_balance(balance, *, account_label: str | None = None, account_type: str | None = None) -> str:
    label = account_label or "account"
    kind = f" {account_type}" if account_type else ""
    return (
        f"On {getattr(balance, 'as_of', None)}, account '{label}'{kind} balance was "
        f"{_money(getattr(balance, 'balance', None), '')}."
    )


def render_payment_method(method, *, account_label: str | None = None) -> str:
    last4 = getattr(method, "last4", None)
    suffix = f" ending in {last4}" if last4 else ""
    account = f" linked to account '{account_label}'" if account_label else ""
    status = "active" if getattr(method, "is_active", False) else "inactive"
    return (
        f"Payment method '{getattr(method, 'name', 'payment method')}' is an {status} "
        f"{getattr(method, 'type', 'method')}{suffix}{account}."
    )


def render_budget(budget, *, category: str | None = None) -> str:
    target = category or "uncategorized spending"
    return (
        f"Budget for {target}: {_money(getattr(budget, 'amount', None), getattr(budget, 'currency', ''))} "
        f"per {getattr(budget, 'period', 'period')}."
    )


def render_merchant(merchant, *, default_category: str | None = None) -> str:
    cat = f" Default category: {default_category}." if default_category else ""
    return f"Merchant '{getattr(merchant, 'canonical_name', 'merchant')}'.{cat}"


def render_category(category, *, parent: str | None = None) -> str:
    parent_text = f" under '{parent}'" if parent else ""
    scope = "system" if getattr(category, "is_system", False) else "household"
    return (
        f"Category '{getattr(category, 'name', 'category')}' is a {scope} "
        f"{getattr(category, 'kind', 'category')}{parent_text}."
    )


def render_tag(tag) -> str:
    return f"Tag '{getattr(tag, 'name', 'tag')}'."


def render_rule(rule) -> str:
    return f"Rule with matcher {getattr(rule, 'matcher', {})} applies action {getattr(rule, 'action', {})}."


def render_income_source(source) -> str:
    employer = getattr(source, "employer", None) or "income source"
    country = f" in {getattr(source, 'country', None)}" if getattr(source, "country", None) else ""
    return (
        f"Income source '{employer}'{country}: gross {_money(getattr(source, 'gross', None), getattr(source, 'currency', ''))}, "
        f"net {_money(getattr(source, 'net', None), getattr(source, 'currency', ''))}, "
        f"frequency {getattr(source, 'frequency', 'unknown')}."
    )


def render_investment_holding(holding, *, account_label: str | None = None) -> str:
    account = f" in account '{account_label}'" if account_label else ""
    symbol = f" ({getattr(holding, 'symbol', None)})" if getattr(holding, "symbol", None) else ""
    return (
        f"Investment holding '{getattr(holding, 'name', 'holding')}'{symbol}{account}: "
        f"{getattr(holding, 'quantity', None)} units of {getattr(holding, 'asset_type', 'asset')}, "
        f"average buy price {_money(getattr(holding, 'avg_buy_price', None), getattr(holding, 'currency', ''))}."
    )


def render_holding_valuation(valuation, *, holding_name: str | None = None) -> str:
    name = holding_name or "holding"
    return (
        f"On {getattr(valuation, 'as_of', None)}, investment '{name}' was valued at "
        f"{_money(getattr(valuation, 'value', None), '')} with price {_money(getattr(valuation, 'price', None), '')}."
    )


def chunk_text(text: str, max_chars: int = 800) -> list[str]:
    paras = [p.strip() for p in (text or "").split("\n\n") if p.strip()]
    chunks: list[str] = []
    for para in paras:
        if len(para) <= max_chars:
            chunks.append(para)
        else:
            for i in range(0, len(para), max_chars):
                chunks.append(para[i : i + max_chars])
    return chunks
