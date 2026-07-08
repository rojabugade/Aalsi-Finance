"""LLM insight producer: reads the assembled context (snapshot + facts + notable
chunks) and surfaces non-obvious findings as AlertSpecs. Best-effort — any
provider failure yields an empty list so deterministic alerts still flow."""

from __future__ import annotations

import hashlib
import json

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.insight.specs import AlertSpec
from app.analyst.schemas import FinancialSnapshot
from app.models.core import User

_TONES = {"positive", "info", "warning", "danger"}

_SYSTEM = (
    "You are a personal-finance analyst scanning a user's data for non-obvious, "
    "actionable findings (rising categories, unusual recurring costs, savings "
    "opportunities). Use ONLY the provided snapshot, facts, and records. Never "
    "invent numbers. Return at most 3 concise insights; return an empty list if "
    "nothing is noteworthy. Use plain text without Markdown."
)


class _Insight(BaseModel):
    title: str
    detail: str
    tone: str = "info"
    severity: int = 5


class _InsightList(BaseModel):
    insights: list[_Insight] = []


def _clamp_severity(value: int) -> int:
    try:
        return max(1, min(9, int(value)))
    except (TypeError, ValueError):
        return 5


async def llm_insight_specs(
    session: AsyncSession, user: User, snapshot: FinancialSnapshot, llm, ctx=None,
) -> list[AlertSpec]:
    if llm is None:
        return []
    refs = None
    body = f"Financial snapshot (JSON):\n{snapshot.model_dump_json()}"
    if ctx is not None:
        if getattr(ctx, "facts", None):
            body += "\n\nKnown facts:\n" + "\n".join(f"- ({f['domain']}) {f['text']}" for f in ctx.facts)
        if getattr(ctx, "chunks", None):
            body += "\n\nRelevant records:\n" + "\n".join(f"- {c['text']}" for c in ctx.chunks)
            refs = [{"source_type": c["source_type"], "source_id": c["source_id"]} for c in ctx.chunks]
    messages = [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": body}]
    try:
        result = await llm.chat(messages, json_schema=_InsightList, purpose="analyst.insight",
                                user_id=user.id, session=session)
        parsed = _InsightList(**result)
    except Exception:  # insight is best-effort; never break the scan
        return []
    specs: list[AlertSpec] = []
    for ins in parsed.insights:
        sig = "insight:" + hashlib.sha1(ins.title.strip().lower().encode("utf-8")).hexdigest()[:12]
        specs.append(AlertSpec(
            kind="insight", producer="insight", severity=_clamp_severity(ins.severity),
            tone=ins.tone if ins.tone in _TONES else "info",
            signature=sig, title=ins.title.strip(), detail=ins.detail.strip(),
            supporting_refs=refs,
        ))
    return specs
