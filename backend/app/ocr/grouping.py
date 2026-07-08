"""Read-time same-receipt grouping for the review queue (pure, no I/O).

Within a single upload batch we cluster receipt/invoice documents by canonical
merchant and propose a merge — but only when their totals don't conflict. The
total conflict is what separates "one receipt photographed twice" from "two
different trips uploaded together". Nothing here touches the DB; callers pass
in already-loaded document objects and persist the outcome themselves.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.ocr import normalize


def _data(document) -> dict:
    return ((document.ocr_meta or {}).get("ocr", {}) or {}).get("data", {}) or {}


def _first_non_null(members, key):
    for m in members:
        value = _data(m).get(key)
        if value is not None and value != "":
            return value
    return None


def merge_extractions(members: list) -> tuple[dict, dict]:
    """Field-union the members' extracted receipt payloads into one.

    merchant/date/currency/subtotal/tax/total -> first non-null in member order
    (the no-conflict rule upstream guarantees totals don't disagree).
    line_items -> concatenation across all members.
    """
    line_items: list = []
    for m in members:
        line_items.extend(_data(m).get("line_items") or [])

    data = {
        "merchant": _first_non_null(members, "merchant"),
        "date": _first_non_null(members, "date"),
        "currency": _first_non_null(members, "currency"),
        "subtotal": _first_non_null(members, "subtotal"),
        "tax": _first_non_null(members, "tax"),
        "total": _first_non_null(members, "total"),
        "line_items": line_items,
    }
    summary = {
        "merchant": data["merchant"],
        "total": data["total"],
        "currency": data["currency"],
        "date": data["date"],
        "line_item_count": len(line_items),
    }
    return data, summary


@dataclass
class ReviewGroup:
    member_ids: list[str]
    data: dict
    summary: dict
    doc_type: str
    confidence: float = 0.0


_GROUPABLE_TYPES = {"receipt", "invoice"}


def _batch_id(document) -> str | None:
    return ((document.ocr_meta or {}).get("ingest", {}) or {}).get("batch_id")


def _group_hint(document) -> str | None:
    return ((document.ocr_meta or {}).get("ingest", {}) or {}).get("group_hint")


def _ocr_confidence(document) -> float:
    return float(((document.ocr_meta or {}).get("ocr", {}) or {}).get("confidence", 0.0) or 0.0)


def _merchant(document) -> str | None:
    return normalize.canonical_merchant(_data(document).get("merchant")) or None


def _total(document):
    return normalize.to_amount(_data(document).get("total"))


def _compatible(d1, d2) -> bool:
    """Could these two be pages of the same receipt?

    Compatible when nothing positively contradicts it: merchants are equal or at
    least one is unreadable, AND totals are equal or at least one is absent. A page
    with no merchant/total is compatible with anything — but the clique rule below
    stops a blank page from bridging two genuinely distinct receipts.
    """
    m1, m2 = _merchant(d1), _merchant(d2)
    if m1 and m2 and m1 != m2:
        return False
    t1, t2 = _total(d1), _total(d2)
    if t1 is not None and t2 is not None and t1 != t2:
        return False
    return True


def group_review_documents(documents: list) -> tuple[list[ReviewGroup], list]:
    """Split needs_review documents into suggested same-receipt groups + loose docs.

    Within one upload batch, groupable docs are clustered so every member is
    compatible with *every* other member (a clique), not merely with one. That
    pairwise-with-all rule is what keeps a blank page from chaining two distinct
    receipts together via mutual compatibility.
    """
    # Bucket groupable docs by batch_id; preserve input order within each batch.
    batches: dict[str, list] = {}
    for doc in documents:
        if doc.type not in _GROUPABLE_TYPES:
            continue
        batch = _batch_id(doc)
        if not batch:
            continue
        batches.setdefault(batch, []).append(doc)

    groups: list[ReviewGroup] = []
    grouped_ids: set = set()
    for members in batches.values():
        forced = len(members) >= 2 and all(_group_hint(m) == "single" for m in members)
        clusters = [members] if forced else _cluster_compatible(members)
        for cluster in clusters:
            if len(cluster) < 2:
                continue
            data, summary = merge_extractions(cluster)
            groups.append(
                ReviewGroup(
                    member_ids=[str(m.id) for m in cluster],
                    data=data,
                    summary=summary,
                    doc_type=cluster[0].type,
                    confidence=min(_ocr_confidence(m) for m in cluster),
                )
            )
            grouped_ids.update(m.id for m in cluster)

    loose = [d for d in documents if d.id not in grouped_ids]
    return groups, loose


def _cluster_compatible(members: list) -> list[list]:
    """Greedily group docs so each joins the first cluster it's compatible with ALL of."""
    clusters: list[list] = []
    for doc in members:
        for cluster in clusters:
            if all(_compatible(doc, other) for other in cluster):
                cluster.append(doc)
                break
        else:
            clusters.append([doc])
    return clusters
