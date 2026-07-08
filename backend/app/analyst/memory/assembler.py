"""Merge the structured snapshot, semantically-retrieved chunks, active facts,
and page scope into one token-budgeted context block for the analyst."""

from __future__ import annotations

import json
from datetime import date

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.memory.retrieve import active_facts, recent_transaction_chunks, retrieve_chunks
from app.analyst.snapshot import build_snapshot
from app.models.core import User


class AssembledContext(BaseModel):
    snapshot: dict
    chunks: list[dict]
    facts: list[dict]
    page: str | None = None
    page_context: dict | None = None


async def assemble(
    session: AsyncSession,
    user: User,
    question: str,
    llm,
    from_date: date,
    to_date: date,
    page: str | None = None,
    page_context: dict | None = None,
    max_chunks: int = 8,
) -> AssembledContext:
    snapshot = await build_snapshot(session, user, from_date, to_date)
    chunks = await retrieve_chunks(session, user, question, llm, limit=max_chunks)
    recent = await recent_transaction_chunks(session, user, limit=5)
    seen = {c.id for c in chunks}
    merged = list(chunks) + [c for c in recent if c.id not in seen]
    facts = await active_facts(session, user)
    return AssembledContext(
        snapshot=snapshot.model_dump(),
        chunks=[
            {"source_type": c.source_type, "source_id": str(c.source_id), "text": c.text}
            for c in merged
        ],
        facts=[{"domain": f.domain, "text": f.text} for f in facts],
        page=page,
        page_context=page_context,
    )


def has_memory(ctx: AssembledContext) -> bool:
    return bool(ctx.chunks or ctx.facts)


def to_prompt(ctx: AssembledContext) -> str:
    parts = [f"Financial snapshot (JSON):\n{json.dumps(ctx.snapshot, default=str)}"]
    if ctx.facts:
        parts.append(
            "Known facts about the user:\n"
            + "\n".join(f"- ({f['domain']}) {f['text']}" for f in ctx.facts)
        )
    if ctx.chunks:
        parts.append(
            "Relevant records from the user's history:\n"
            + "\n".join(
                f"- [{c['source_type']}:{c['source_id']}] {c['text']}" for c in ctx.chunks
            )
        )
    if ctx.page_context:
        pc = ctx.page_context
        bits = []
        if pc.get("route"):
            bits.append(f"route {pc['route']}")
        if pc.get("entity"):
            bits.append(f"viewing '{pc['entity']}'")
        if pc.get("visible_range"):
            bits.append(f"visible range {pc['visible_range']}")
        if pc.get("filters"):
            bits.append(f"filters {json.dumps(pc['filters'])}")
        if bits:
            parts.append("Current view: " + "; ".join(bits) + ".")
    elif ctx.page:
        parts.append(f"The user is currently on the {ctx.page} page.")
    return "\n\n".join(parts)
