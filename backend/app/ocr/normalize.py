"""Field normalisation for extracted data (M5): dates, amounts, currency, merchant.

Pure functions over already-extracted values — no I/O — so they unit-test trivially.
The goal is canonical, M6-ready values: ISO dates, `Decimal` amounts, ISO-4217
currency codes, and a tidied merchant name. Sign semantics for transactions stay
with M6; here we only clean the numeric value (and combine CSV debit/credit columns).
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from dateutil import parser as date_parser

# Common currency symbols → ISO-4217.
_SYMBOL_CCY = {
    "$": "USD",
    "us$": "USD",
    "₹": "INR",
    "rs": "INR",
    "rs.": "INR",
    "inr": "INR",
    "£": "GBP",
    "€": "EUR",
    "¥": "JPY",
}


def to_iso_date(raw: str | None) -> str | None:
    """Parse a date string to ISO `YYYY-MM-DD`. Returns None if unparseable.

    `dayfirst=False` defaults to US ordering (MM/DD/YYYY); ambiguous non-US sources
    should be disambiguated by M6 using account/locale context.
    """
    if not raw or not str(raw).strip():
        return None
    try:
        dt = date_parser.parse(str(raw), dayfirst=False, fuzzy=True)
        return dt.date().isoformat()
    except (ValueError, OverflowError, TypeError):
        return None


def to_amount(value) -> Decimal | None:
    """Coerce a money-ish value to `Decimal`, stripping symbols, commas, spaces.

    Parentheses denote a negative (accounting style): `(12.50)` → `-12.50`.
    """
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    s = str(value).strip()
    if not s:
        return None
    negative = s.startswith("(") and s.endswith(")")
    cleaned = []
    for ch in s:
        if ch.isdigit() or ch in ".-":
            cleaned.append(ch)
    text = "".join(cleaned).strip("-") if negative else "".join(cleaned)
    if not text or text in {".", "-", "-."}:
        return None
    try:
        amount = Decimal(text)
    except InvalidOperation:
        return None
    return -amount if negative else amount


def normalize_currency(raw: str | None, default: str | None = None) -> str | None:
    if not raw:
        return default.upper() if default else None
    s = str(raw).strip().lower()
    if s in _SYMBOL_CCY:
        return _SYMBOL_CCY[s]
    # Pull a leading symbol off e.g. "$12.50".
    for sym, ccy in _SYMBOL_CCY.items():
        if s.startswith(sym):
            return ccy
    if len(s) == 3 and s.isalpha():
        return s.upper()
    return default.upper() if default else None


def canonical_merchant(raw: str | None) -> str | None:
    """Tidy a merchant string: collapse whitespace, drop trailing store numbers."""
    if not raw:
        return None
    parts = str(raw).strip().split()
    # Drop a trailing pure-number token (store/branch id) like "WALMART 2148".
    if len(parts) > 1 and parts[-1].isdigit():
        parts = parts[:-1]
    name = " ".join(parts).strip(" -#,.")
    return name or None


def combine_debit_credit(debit, credit) -> Decimal | None:
    """CSV with separate debit/credit columns → one signed amount (debit negative)."""
    d = to_amount(debit)
    c = to_amount(credit)
    if d is not None and d != 0:
        return -abs(d)
    if c is not None and c != 0:
        return abs(c)
    return Decimal("0") if (d is not None or c is not None) else None
