"""Correlation producer (W3 §2c): for each active health/lifestyle fact, retrieve
the user's transactions that semantically match it and ask the LLM whether any
genuinely conflict with or confirm the fact (e.g. a peanut allergy vs. peanut
purchases). Emits `correlation` AlertSpecs with supporting_refs pointing at the
fact and the matched transactions. Best-effort: no LLM, retrieval failure, or any
provider error yields an empty list so the rest of the scan still flows."""

from __future__ import annotations

import hashlib

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.insight.specs import AlertSpec
from app.analyst.memory.retrieve import retrieve_chunks
from app.auth.deps import scoped_query
from app.models.core import User
from app.models.memory import MemoryFact

_TONES = {"positive", "info", "warning", "danger"}
_CORRELATABLE_DOMAINS = ("health", "lifestyle")

_SYSTEM = (
    "You are a cross-domain analyst. You are given ONE durable fact about a user "
    "(a health condition or lifestyle constraint) and a list of their recent "
    "transactions. Decide whether any transactions genuinely conflict with or "
    "confirm the fact (e.g. an allergen being purchased). Report a correlation "
    "ONLY if it is real and specific to the listed transactions; otherwise set "
    "found=false. Never invent transactions or numbers. Use plain text without "
    "Markdown."
)


class _Correlation(BaseModel):
    found: bool = False
    title: str = ""
    detail: str = ""
    tone: str = "warning"
    severity: int = 6


def _clamp_severity(value: int) -> int:
    try:
        return max(1, min(9, int(value)))
    except (TypeError, ValueError):
        return 6


async def _correlatable_facts(session: AsyncSession, user: User) -> list[MemoryFact]:
    rows = (await session.execute(
        scoped_query(MemoryFact, user).where(MemoryFact.status == "active")
    )).scalars().all()
    return [f for f in rows if f.domain in _CORRELATABLE_DOMAINS]


def _fact_query(fact: MemoryFact) -> str:
    terms = [fact.text]
    if isinstance(fact.structured, dict):
        terms += [str(v) for v in fact.structured.values() if v]
    return " ".join(terms)


async def correlation_specs(session: AsyncSession, user: User, llm) -> list[AlertSpec]:
    if llm is None:
        return []
    facts = await _correlatable_facts(session, user)
    specs: list[AlertSpec] = []
    for fact in facts:
        try:
            chunks = await retrieve_chunks(session, user, _fact_query(fact), llm, limit=6)
        except Exception:
            continue
        txns = [c for c in chunks if c.source_type == "transaction"]
        if not txns:
            continue
        body = (
            f"Fact ({fact.domain}): {fact.text}\n\nRecent transactions:\n"
            + "\n".join(f"- [{c.source_id}] {c.text}" for c in txns)
        )
        try:
            result = await llm.chat(
                [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": body}],
                json_schema=_Correlation, purpose="analyst.correlation",
                user_id=user.id, session=session,
            )
            parsed = _Correlation(**result)
        except Exception:  # correlation is best-effort; never break the scan
            continue
        if not parsed.found or not parsed.title.strip():
            continue
        refs: list[dict] = [{"source_type": "fact", "source_id": str(fact.id)}]
        refs += [{"source_type": "transaction", "source_id": str(c.source_id)} for c in txns]
        sig = "correlation:" + hashlib.sha1(
            f"{fact.id}:{parsed.title.strip().lower()}".encode("utf-8")
        ).hexdigest()[:12]
        specs.append(AlertSpec(
            kind="correlation", producer="correlation",
            severity=_clamp_severity(parsed.severity),
            tone=parsed.tone if parsed.tone in _TONES else "warning",
            signature=sig, title=parsed.title.strip(), detail=parsed.detail.strip(),
            supporting_refs=refs,
        ))
    return specs
