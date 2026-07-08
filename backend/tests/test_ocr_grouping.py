from __future__ import annotations

from types import SimpleNamespace

from app.ocr.grouping import merge_extractions


def _doc(doc_id, merchant=None, total=None, date=None, currency=None,
         subtotal=None, tax=None, line_items=None, doc_type="receipt",
         group_hint=None):
    ingest = {"batch_id": "b1"}
    if group_hint:
        ingest["group_hint"] = group_hint
    return SimpleNamespace(
        id=doc_id,
        type=doc_type,
        ocr_meta={
            "ingest": ingest,
            "ocr": {
                "doc_type": doc_type,
                "data": {
                    "merchant": merchant,
                    "date": date,
                    "currency": currency,
                    "subtotal": subtotal,
                    "tax": tax,
                    "total": total,
                    "line_items": line_items or [],
                },
                "confidence": 0.5,
                "summary": {},
            },
        },
    )


def test_merge_unions_complementary_fields():
    a = _doc("a", merchant="Walmart", line_items=[{"name": "Milk", "amount": "3.00"}])
    b = _doc("b", merchant=None, total="42.10", date="2026-06-27", currency="USD",
             line_items=[{"name": "Eggs", "amount": "5.00"}])
    data, summary = merge_extractions([a, b])
    assert data["merchant"] == "Walmart"   # first non-null
    assert data["total"] == "42.10"        # only non-null total
    assert data["date"] == "2026-06-27"
    assert data["currency"] == "USD"
    assert [li["name"] for li in data["line_items"]] == ["Milk", "Eggs"]  # concatenated
    assert summary["merchant"] == "Walmart"
    assert summary["total"] == "42.10"
    assert summary["line_item_count"] == 2


from app.ocr.grouping import group_review_documents, ReviewGroup


def test_groups_same_merchant_complementary_batch():
    a = _doc("a", merchant="Walmart")
    b = _doc("b", merchant="Walmart", total="42.10")
    groups, loose = group_review_documents([a, b])
    assert len(groups) == 1
    assert isinstance(groups[0], ReviewGroup)
    assert groups[0].member_ids == ["a", "b"]
    assert groups[0].data["total"] == "42.10"
    assert loose == []


def test_conflicting_totals_stay_loose():
    a = _doc("a", merchant="Walmart", total="10.00")
    b = _doc("b", merchant="Walmart", total="99.00")  # different trip
    groups, loose = group_review_documents([a, b])
    assert groups == []
    assert {d.id for d in loose} == {"a", "b"}


def test_different_merchants_not_grouped():
    a = _doc("a", merchant="Walmart", total="10.00")
    b = _doc("b", merchant="Target", total="20.00")
    groups, loose = group_review_documents([a, b])
    assert groups == []
    assert len(loose) == 2


def test_group_hint_single_forces_one_group_despite_conflicts():
    a = _doc("a", merchant="Costco", total="10.00", group_hint="single")
    b = _doc("b", merchant="Target", total="99.00", group_hint="single")

    groups, loose = group_review_documents([a, b])

    assert len(groups) == 1
    assert set(groups[0].member_ids) == {"a", "b"}
    assert loose == []


def test_different_batches_never_group():
    a = _doc("a", merchant="Walmart")
    b = _doc("b", merchant="Walmart", total="42.10")
    b.ocr_meta["ingest"]["batch_id"] = "other-batch"
    groups, loose = group_review_documents([a, b])
    assert groups == []
    assert len(loose) == 2


def test_missing_batch_id_is_loose():
    a = _doc("a", merchant="Walmart")
    a.ocr_meta["ingest"].pop("batch_id")
    b = _doc("b", merchant="Walmart", total="42.10")
    b.ocr_meta["ingest"].pop("batch_id")
    groups, loose = group_review_documents([a, b])
    assert groups == []
    assert len(loose) == 2


def test_statement_and_csv_stay_loose():
    a = _doc("a", merchant="Walmart")
    s = _doc("s", merchant=None, doc_type="statement")
    groups, loose = group_review_documents([a, s])
    assert groups == []          # a is alone in its cluster, s isn't groupable
    assert {d.id for d in loose} == {"a", "s"}


def test_agreeing_totals_group():
    a = _doc("a", merchant="Walmart", total="42.10")
    b = _doc("b", merchant="Walmart", total="42.10")  # both pages show the total
    groups, loose = group_review_documents([a, b])
    assert len(groups) == 1
    assert groups[0].data["total"] == "42.10"


def test_groups_when_merchant_unreadable_on_both_pages():
    # One physical receipt photographed as two images in one batch; OCR read no
    # merchant header on either page and no total line. Same batch is enough signal.
    a = _doc("a", merchant=None, total=None)
    b = _doc("b", merchant=None, total=None)
    groups, loose = group_review_documents([a, b])
    assert len(groups) == 1
    assert groups[0].member_ids == ["a", "b"]
    assert loose == []


def test_groups_when_one_page_has_merchant_other_blank():
    # Header page reads the merchant; the continuation page reads neither merchant
    # nor a total. They still belong to one receipt.
    a = _doc("a", merchant="Walmart", total=None)
    b = _doc("b", merchant=None, total="42.10")
    groups, loose = group_review_documents([a, b])
    assert len(groups) == 1
    assert set(groups[0].member_ids) == {"a", "b"}


def test_blank_page_does_not_bridge_distinct_merchants():
    # A Walmart receipt + a Target receipt + a blank page, all one batch. The blank
    # page is compatible with both, but must NOT transitively merge the two distinct
    # receipts into a single group.
    a = _doc("a", merchant="Walmart", total="10.00")
    t = _doc("t", merchant="Target", total="20.00")
    blank = _doc("blank", merchant=None, total=None)
    groups, loose = group_review_documents([a, t, blank])
    assert all(not {"a", "t"} <= set(g.member_ids) for g in groups)


def test_garbage_merchant_and_blank_still_group_when_totals_absent():
    # The real-world failure: one page reads None merchant, the other reads a garbage
    # line-item as the "merchant"; neither has a real total. One missing merchant
    # makes them compatible, so they group rather than each landing loose.
    a = _doc("a", merchant=None, total=None)
    b = _doc("b", merchant="FS SWAD pe ner", total=None)
    groups, loose = group_review_documents([a, b])
    assert len(groups) == 1
    assert set(groups[0].member_ids) == {"a", "b"}


from app.ocr.router import build_review_queue


def test_build_review_queue_separates_groups_and_loose():
    a = _doc("a", merchant="Walmart")
    b = _doc("b", merchant="Walmart", total="42.10")
    c = _doc("c", merchant="Target", total="20.00")
    for d in (a, b, c):
        d.status = "needs_review"
    out = build_review_queue([a, b, c])
    assert len(out.groups) == 1
    grp = out.groups[0]
    assert grp.member_document_ids == ["a", "b"]
    assert grp.suggested.summary["total"] == "42.10"
    assert grp.suggested.batch_id == "b1"
    assert {m.document_id for m in grp.members} == {"a", "b"}
    assert [i.document_id for i in out.items] == ["c"]
