from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import scoped_query
from app.config import Settings, get_settings
from app.fx import service as fx_service
from app.guidance.schemas import CrossBorderTransferIn, GuidanceAskIn, GuidanceWizardIn
from app.llm.client import LLMClient
from app.models.core import User
from app.models.fx import CrossBorderTransfer
from app.models.guidance import GuidanceDoc
from app.notifications.service import enqueue_notification

DISCLAIMER = (
    "General information and education only; not financial, tax, legal, or investment advice. "
    "Verify cited sources and consult a CPA/CA, attorney, or licensed financial professional."
)


def _country(v: str | None) -> str | None:
    return v.upper()[:2] if v else None


def _currency(v: str | None) -> str:
    return (v or "USD").upper()[:3]


def _money(v) -> Decimal:
    return Decimal(str(v or "0")).quantize(Decimal("0.01"))


async def ask_guidance(session: AsyncSession, user: User, data: GuidanceAskIn, llm: LLMClient | None = None) -> dict:
    docs = await retrieve_docs(session, data.question, country=data.country, topic=data.topic, llm=llm, user=user)
    citations = [_citation(doc) for doc in docs]
    if not docs:
        return {"answer": "I could not find relevant guidance in the curated corpus. Add or refresh source documents before relying on an answer.", "citations": [], "disclaimer": DISCLAIMER}

    context = "\n\n".join(
        f"[{i+1}] {doc.title} ({doc.source_type}, effective {doc.effective_date})\n{doc.body}"
        for i, doc in enumerate(docs)
    )
    fallback = _source_grounded_answer(data.question, docs)
    if llm is None:
        return {"answer": fallback, "citations": citations, "disclaimer": DISCLAIMER}
    try:
        result = await llm.chat(
            [
                {"role": "system", "content": "Answer only from the provided corpus. Distinguish government/official sources from community consensus. Cite bracket numbers. If the corpus is insufficient, say so."},
                {"role": "user", "content": f"Question: {data.question}\n\nCorpus:\n{context}"},
            ],
            purpose="guidance.ask",
            user_id=user.id,
            session=session,
            use_cache=True,
        )
        answer = result.get("content") or fallback
    except Exception:
        answer = fallback
    return {"answer": answer, "citations": citations, "disclaimer": DISCLAIMER}


async def retrieve_docs(session: AsyncSession, query: str, *, country: str | None = None, topic: str | None = None, llm: LLMClient | None = None, user: User | None = None, limit: int = 5) -> list[GuidanceDoc]:
    stmt = select(GuidanceDoc)
    if country:
        cc = _country(country)
        stmt = stmt.where(or_(GuidanceDoc.country == cc, GuidanceDoc.country.is_(None)))
    if topic:
        stmt = stmt.where(GuidanceDoc.topic.ilike(f"%{topic}%"))

    query_vec = None
    if llm is not None:
        try:
            query_vec = (await llm.embed(query, purpose="guidance.retrieve", user_id=user.id if user else None, session=session))[0]
        except Exception:
            query_vec = None
    if query_vec is not None:
        stmt = stmt.order_by(GuidanceDoc.embedding.l2_distance(query_vec)).limit(limit)
    else:
        terms = [t for t in re.split(r"\W+", query.lower()) if len(t) > 3][:8]
        if terms:
            filters = [GuidanceDoc.body.ilike(f"%{term}%") | GuidanceDoc.title.ilike(f"%{term}%") | GuidanceDoc.topic.ilike(f"%{term}%") for term in terms]
            stmt = stmt.where(or_(*filters))
        stmt = stmt.order_by(GuidanceDoc.effective_date.desc().nullslast(), GuidanceDoc.title.asc()).limit(limit)
    return list((await session.execute(stmt)).scalars().all())


async def wizard(session: AsyncSession, user: User, data: GuidanceWizardIn) -> dict:
    countries = [_country(c) for c in data.countries if _country(c)]
    stmt = select(GuidanceDoc).where(GuidanceDoc.country.in_(countries) if countries else GuidanceDoc.country.is_not(None)).order_by(GuidanceDoc.source_type.asc(), GuidanceDoc.topic.asc()).limit(12)
    docs = list((await session.execute(stmt)).scalars().all())
    checklist = []
    for doc in docs:
        checklist.append({
            "title": doc.title,
            "topic": doc.topic,
            "source_type": doc.source_type,
            "why_it_may_apply": _why_applies(doc, data),
            "source_url": doc.source_url,
            "effective_date": str(doc.effective_date) if doc.effective_date else None,
        })
    reminders = []
    for idx, item in enumerate(checklist[:5], start=1):
        payload = {"checklist_item": item["title"], "topic": item["topic"], "source_url": item["source_url"]}
        await enqueue_notification(
            session,
            household_id=user.household_id,
            user_id=user.id,
            type="cross_border_checklist",
            payload=payload,
            scheduled_for=datetime.now(timezone.utc),
            idempotency_key=f"cross_border_checklist:{user.id}:{idx}:{item['title']}",
        )
        reminders.append(payload)
    await session.commit()
    return {"checklist": checklist, "reminders": reminders, "citations": [_citation(d) for d in docs], "disclaimer": DISCLAIMER}


async def checklist(session: AsyncSession) -> dict:
    docs = list((await session.execute(select(GuidanceDoc).order_by(GuidanceDoc.country.asc().nullslast(), GuidanceDoc.topic.asc()).limit(50))).scalars().all())
    items = [{"title": doc.title, "country": doc.country, "topic": doc.topic, "source_type": doc.source_type, "source_url": doc.source_url, "effective_date": str(doc.effective_date) if doc.effective_date else None} for doc in docs]
    return {"checklist": items, "citations": [_citation(d) for d in docs], "disclaimer": DISCLAIMER}


async def list_transfers(session: AsyncSession, user: User) -> list[CrossBorderTransfer]:
    rows = list((await session.execute(scoped_query(CrossBorderTransfer, user).order_by(CrossBorderTransfer.transfer_date.desc().nullslast()))).scalars().all())
    for row in rows:
        await _attach_base_transfer_amount(session, row)
    return rows


async def create_transfer(session: AsyncSession, user: User, data: CrossBorderTransferIn) -> CrossBorderTransfer:
    transfer_date = data.transfer_date or date.today()
    from_currency = _currency(data.from_currency)
    to_currency = _currency(data.to_currency)
    fx_rate = Decimal(str(data.fx_rate)) if data.fx_rate is not None else (await fx_service.convert(session, 1, from_currency, to_currency, transfer_date))[1]
    row = CrossBorderTransfer(
        household_id=user.household_id,
        owner_user_id=user.id,
        direction=data.direction,
        from_currency=from_currency,
        to_currency=to_currency,
        amount=_money(data.amount),
        fx_rate=fx_rate,
        purpose=data.purpose,
        channel=data.channel,
        transfer_date=transfer_date,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    await _attach_base_transfer_amount(session, row)
    return row


async def _attach_base_transfer_amount(session: AsyncSession, row: CrossBorderTransfer) -> None:
    try:
        base_amount, _rate, _rate_date, base = await fx_service.convert_to_household_base(
            session,
            row.household_id,
            row.amount,
            row.from_currency,
            row.transfer_date or date.today(),
        )
    except fx_service.FXRateUnavailable:
        return
    row.base_amount = base_amount
    row.base_currency = base


async def limits(session: AsyncSession, user: User) -> dict:
    totals_rows = (await session.execute(
        select(CrossBorderTransfer.from_currency, CrossBorderTransfer.to_currency, func.sum(CrossBorderTransfer.amount))
        .where(CrossBorderTransfer.household_id == user.household_id)
        .group_by(CrossBorderTransfer.from_currency, CrossBorderTransfer.to_currency)
    )).all()
    totals = [{"from_currency": r[0], "to_currency": r[1], "amount": str(_money(r[2]))} for r in totals_rows]
    docs = list((await session.execute(select(GuidanceDoc).where(GuidanceDoc.topic.ilike("%limit%")).order_by(GuidanceDoc.effective_date.desc().nullslast()).limit(10))).scalars().all())
    parsed_limits = [_parse_limit(doc) for doc in docs]
    parsed_limits = [item for item in parsed_limits if item]
    warnings = []
    for total in totals:
        for item in parsed_limits:
            if item["currency"] == total["from_currency"]:
                ratio = _money(total["amount"]) / _money(item["amount"]) if _money(item["amount"]) else Decimal("0")
                if ratio >= Decimal("0.80"):
                    warnings.append({"message": "Transfer total is near a corpus-defined limit; verify the cited source before acting.", "ratio": str(ratio.quantize(Decimal("0.01"))), "limit_title": item["title"]})
    return {"totals": totals, "limits": parsed_limits, "warnings": warnings, "citations": [_citation(d) for d in docs]}


async def reindex_corpus(session: AsyncSession, llm: LLMClient | None = None, settings: Settings | None = None) -> dict:
    settings = settings or get_settings()
    corpus_dir = Path(settings.corpus_dir)
    if not corpus_dir.is_absolute():
        corpus_dir = Path(__file__).resolve().parents[3] / settings.corpus_dir
    files = sorted(corpus_dir.glob("**/*.md"))
    indexed = 0
    for path in files:
        if path.name.lower() == "readme.md":
            continue
        meta, body = _parse_corpus_file(path)
        if not body.strip():
            continue
        chunks = _chunk(body)
        embeddings: list[list[float] | None] = [None] * len(chunks)
        if llm is not None:
            try:
                embeddings = await llm.embed(chunks, purpose="guidance.reindex", session=session)
            except Exception:
                embeddings = [None] * len(chunks)
        for idx, chunk in enumerate(chunks):
            doc = GuidanceDoc(
                country=_country(meta.get("country")),
                topic=meta.get("topic"),
                title=meta.get("title") or path.stem,
                body=chunk,
                source_url=meta.get("source_url"),
                source_type=meta.get("source_type") or "other",
                effective_date=_date(meta.get("effective_date")),
                embedding=embeddings[idx],
            )
            session.add(doc)
            indexed += 1
    await session.commit()
    return {"indexed": indexed, "corpus_dir": str(corpus_dir)}


def _parse_corpus_file(path: Path) -> tuple[dict, str]:
    text = path.read_text(encoding="utf-8")
    if text.startswith("---"):
        _, raw_meta, body = text.split("---", 2)
        meta = {}
        for line in raw_meta.splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip().strip('"')
        return meta, body.strip()
    return {}, text


def _chunk(text: str, size: int = 2400) -> list[str]:
    paras = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks, current = [], ""
    for para in paras:
        if len(current) + len(para) > size and current:
            chunks.append(current.strip())
            current = para
        else:
            current = f"{current}\n\n{para}" if current else para
    if current:
        chunks.append(current.strip())
    return chunks or [text[:size]]


def _citation(doc: GuidanceDoc) -> dict:
    return {"title": doc.title, "source_url": doc.source_url, "source_type": doc.source_type, "effective_date": doc.effective_date}


def _source_grounded_answer(question: str, docs: list[GuidanceDoc]) -> str:
    govt = [d for d in docs if d.source_type == "govt"]
    community = [d for d in docs if d.source_type == "community"]
    parts = [f"Based on the curated corpus for: {question}"]
    if govt:
        parts.append("Government/official sources: " + "; ".join(f"[{i+1}] {d.title}" for i, d in enumerate(govt)))
    if community:
        parts.append("Community consensus sources: " + "; ".join(f"{d.title}" for d in community))
    parts.append("Use the citations and effective dates to verify current rules before acting.")
    return "\n".join(parts)


def _why_applies(doc: GuidanceDoc, data: GuidanceWizardIn) -> str:
    text = "May apply because it is in the selected country/cross-border corpus."
    if data.annual_transfer_amount is not None and "limit" in (doc.topic or "").lower():
        text = "May apply because you entered an annual transfer amount and this source discusses limits or thresholds."
    if data.account_types and any(a.lower() in (doc.body or "").lower() for a in data.account_types):
        text = "May apply because this source mentions one of your account types."
    return text


def _parse_limit(doc: GuidanceDoc) -> dict | None:
    body = doc.body or ""
    amount = re.search(r"limit_amount\s*:\s*([0-9,.]+)", body, re.I)
    currency = re.search(r"limit_currency\s*:\s*([A-Z]{3})", body, re.I)
    period = re.search(r"limit_period\s*:\s*([^\n]+)", body, re.I)
    if not amount or not currency:
        return None
    return {"title": doc.title, "amount": amount.group(1).replace(",", ""), "currency": currency.group(1), "period": period.group(1).strip() if period else None, "source_url": doc.source_url, "effective_date": str(doc.effective_date) if doc.effective_date else None}


def _date(value: str | None):
    if not value:
        return None
    return datetime.fromisoformat(value[:10]).date()
