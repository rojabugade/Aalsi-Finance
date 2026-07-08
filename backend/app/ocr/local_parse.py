"""Deterministic, on-box extraction fallback — no LLM, no network.

When no LLM is configured or reachable, we still want the user to get *something*
to confirm rather than an empty card. These heuristics parse the OCR'd text locally
(nothing leaves the box) and emit the same "raw" dict shape the LLM would, so the
existing per-type normalizers in ``service`` handle the rest.

Confidence is deliberately modest so results route to the review queue for human
confirmation — this is a baseline, not a replacement for a real extractor.
"""

from __future__ import annotations

import re

_CURRENCY_SYMBOLS = {"$": "USD", "₹": "INR", "€": "EUR", "£": "GBP", "¥": "JPY"}

# A money-like number, optionally preceded by a currency symbol. Handles 1,234.56.
_AMOUNT_RE = re.compile(r"(?P<sym>[$₹€£¥])?\s?(?P<num>\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+\.\d{1,2})")
_DATE_RE = re.compile(
    r"\b(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|"
    r"\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{2,4})\b",
    re.IGNORECASE,
)

_TOTAL_KEYS = ("grand total", "amount due", "balance due", "amount paid", "total")
_SUBTOTAL_KEYS = ("subtotal", "sub total", "sub-total")
_TAX_KEYS = ("tax", "gst", "vat", "hst")

_STATEMENT_HINTS = ("statement", "account number", "opening balance", "closing balance",
                    "available balance", "sort code", "iban")
_PAYSTUB_HINTS = ("net pay", "gross pay", "payslip", "pay stub", "paystub", "earnings",
                  "deductions", "ytd", "employer")
_LOAN_HINTS = ("loan", "principal", "outstanding", "emi", "equated monthly",
               "installment", "disbursement", "amortization", "annual percentage rate",
               "apr", "lender", "mortgage", "financed amount")
_RECEIPT_HINTS = ("subtotal", "total", "qty", "cashier", "receipt", "invoice", "change due")


def classify(text: str) -> str | None:
    """Best-effort document-type guess from OCR text. None if nothing matches."""
    if not text or not text.strip():
        return None
    low = text.lower()
    scores = {
        "paystub": sum(h in low for h in _PAYSTUB_HINTS),
        "statement": sum(h in low for h in _STATEMENT_HINTS),
        "loan": sum(h in low for h in _LOAN_HINTS),
        "receipt": sum(h in low for h in _RECEIPT_HINTS),
    }
    # A page with several currency-tagged amounts is almost certainly financial;
    # treat it as a receipt unless paystub/statement hints clearly dominate. This
    # rescues noisy OCR where keyword words (sub/total) are garbled but prices read.
    if len(_amounts(text, require_symbol=True)) >= 3:
        scores["receipt"] += 2
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else None


def _amounts(text: str, require_symbol: bool = False) -> list[float]:
    out: list[float] = []
    for m in _AMOUNT_RE.finditer(text):
        if require_symbol and not m.group("sym"):
            continue
        try:
            out.append(float(m.group("num").replace(",", "")))
        except ValueError:
            continue
    return out


def _currency(text: str) -> str | None:
    for sym, iso in _CURRENCY_SYMBOLS.items():
        if sym in text:
            return iso
    return None


def _amount_after_keyword(text: str, keywords: tuple[str, ...]) -> float | None:
    low = text.lower()
    for kw in keywords:
        idx = low.find(kw)
        if idx == -1:
            continue
        window = text[idx : idx + len(kw) + 24]
        nums = _amounts(window[len(kw):])
        if nums:
            return nums[0]
    return None


def _first_date(text: str) -> str | None:
    m = _DATE_RE.search(text)
    return m.group(1) if m else None


def _looks_like_name(s: str) -> bool:
    """A plausible merchant line: enough letters, not just 1–2 char OCR fragments."""
    if len(s) < 4 or _AMOUNT_RE.search(s):
        return False
    letters = [c for c in s if c.isalpha()]
    if len(letters) < 4 or len(letters) / len(s) < 0.6:
        return False
    # Reject garbage like "ao i om" — needs at least one real word (3+ letters).
    return any(len(tok) >= 3 and tok.isalpha() for tok in s.split())


def _merchant(text: str) -> str | None:
    # Receipts put the merchant name at the top — scan the first lines for the
    # first plausible name. Returns None (→ "Unknown") rather than emitting OCR
    # noise from a curled/blurry header, which the user would just have to delete.
    for line in text.splitlines()[:8]:
        s = line.strip()
        if _looks_like_name(s):
            return s[:80]
    return None


def _parse_receipt(text: str) -> dict:
    # The grand total must come from an explicit total line — never the largest
    # amount. Fabricating one from the biggest line item invents a wrong number
    # (e.g. the largest *item* price on a partial page) and makes two images of the
    # SAME receipt look like they have conflicting totals, which blocks grouping.
    total = _amount_after_keyword(text, _TOTAL_KEYS)
    subtotal = _amount_after_keyword(text, _SUBTOTAL_KEYS)
    tax = _amount_after_keyword(text, _TAX_KEYS)
    have = sum(v is not None for v in (total, _first_date(text), _merchant(text)))
    return {
        "merchant": _merchant(text),
        "date": _first_date(text),
        "currency": _currency(text),
        "subtotal": subtotal,
        "tax": tax,
        "total": total,
        "line_items": [],
        "confidence": round(min(0.6, 0.2 * have), 2),
    }


def _parse_statement(text: str) -> dict:
    return {
        "account_hint": _merchant(text),
        "transactions": [],
        "confidence": 0.2,
    }


def _parse_paystub(text: str) -> dict:
    return {
        "employer": _merchant(text),
        "period_start": None,
        "period_end": _first_date(text),
        "gross": _amount_after_keyword(text, ("gross pay", "gross")),
        "net": _amount_after_keyword(text, ("net pay", "net")),
        "deductions": [],
        "confidence": 0.2,
    }


def _parse_loan(text: str) -> dict:
    return {
        "name": _merchant(text),
        "type": "other",
        "principal": _amount_after_keyword(
            text, ("principal", "outstanding", "balance", "loan amount", "amount financed")
        ),
        "interest_rate": None,
        "min_or_emi_amount": _amount_after_keyword(
            text, ("emi", "monthly payment", "installment", "monthly installment")
        ),
        "start_date": _first_date(text),
        "due_day": None,
        "confidence": 0.2,
    }


_PARSERS = {
    "receipt": _parse_receipt,
    "invoice": _parse_receipt,
    "statement": _parse_statement,
    "paystub": _parse_paystub,
    "loan": _parse_loan,
}


def parse(doc_type: str, text: str) -> dict:
    """Heuristic extraction for ``doc_type`` from OCR ``text``. Empty-ish on no match."""
    parser = _PARSERS.get(doc_type, _parse_receipt)
    if not text or not text.strip():
        return {"confidence": 0.0}
    return parser(text)
