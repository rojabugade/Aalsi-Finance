"""Deterministic local OCR-text parsing (no LLM, no DB)."""

from __future__ import annotations

from app.ocr import local_parse

# Mimics noisy receipt OCR: garbled words, barcodes, $-tagged prices, a total.
RECEIPT_TEXT = """
FS FLOUR BAG-999 1.99/pc $1.99
FS SWAD PENUTS SKINLESS 2802-0511791929 $4.99
FS KURKURE-8901491100519 $0.99
FS EVEREST CHOLE MASALA-8901786091003 $2.99
SUBTOTAL $158.35
GRAND TOTAL $158.35
CREDIT CARD PURCHASE $158.35
Card Type: MasterCard
"""


def test_classify_detects_receipt_from_money_signals():
    assert local_parse.classify(RECEIPT_TEXT) == "receipt"


def test_classify_none_on_empty():
    assert local_parse.classify("") is None
    assert local_parse.classify("   \n  ") is None


def test_classify_paystub_and_statement_keywords():
    assert local_parse.classify("Employer Acme\nGross Pay 5000\nNet Pay 3800\nDeductions") == "paystub"
    assert local_parse.classify("Account Number 123\nOpening Balance\nClosing Balance") == "statement"


def test_parse_receipt_total_ignores_barcodes():
    out = local_parse.parse("receipt", RECEIPT_TEXT)
    # The $-tagged total wins over the long barcode digit strings.
    assert out["total"] == 158.35
    assert out["currency"] == "USD"
    assert out["confidence"] > 0


def test_parse_total_prefers_keyword_amount():
    text = "Item A $5.00\nItem B $7.00\nTotal $12.00"
    assert local_parse.parse("receipt", text)["total"] == 12.0


def test_parse_empty_text_is_zero_confidence():
    assert local_parse.parse("receipt", "")["confidence"] == 0.0


def test_parse_receipt_no_total_keyword_leaves_total_none():
    # A continuation/partial receipt image with line items but no "total" line.
    # We must NOT fabricate a grand total from the largest amount — that invents a
    # wrong number (e.g. 9.99 for a $150 receipt) and makes two pages of the SAME
    # receipt look like conflicting totals, blocking same-receipt grouping.
    text = "Milk $3.00\nEggs $5.00\nBread $2.50"
    assert local_parse.parse("receipt", text)["total"] is None
