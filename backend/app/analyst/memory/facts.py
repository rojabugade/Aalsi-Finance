"""LLM extraction of durable facts (allergies, income shape, goals) from a
document's text, plus the per-document indexing entry point."""

from __future__ import annotations

from pydantic import BaseModel
from sqlalchemy import delete as _delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.analyst.memory import render
from app.analyst.memory.indexer import index_chunks
from app.models.core import User
from app.models.documents import Document
from app.models.memory import MemoryChunk as _Chunk
from app.models.memory import MemoryFact

_DOMAINS = {"finance", "health", "lifestyle", "goal"}


class _Fact(BaseModel):
    text: str
    structured: dict | None = None
    confidence: float | None = None


class ExtractedFacts(BaseModel):
    domain: str
    facts: list[_Fact]


_SYSTEM = (
    "You read a user's uploaded document and extract durable, reusable facts about "
    "them (allergies, medical conditions, income shape, financial goals, dietary "
    "preferences). Classify the document's primary domain as one of finance, health, "
    "lifestyle, goal. Return only facts clearly supported by the text; never invent."
)


async def extract_facts(
    session: AsyncSession, user: User, document: Document, llm
) -> list[MemoryFact]:
    """Extract and persist durable facts from a document's extracted_text.

    Returns the list of persisted MemoryFact rows, or [] on any failure.
    """
    text = (document.extracted_text or "").strip()
    if not text:
        return []
    try:
        result = await llm.chat(
            [
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": f"Document text:\n{text}"},
            ],
            json_schema=ExtractedFacts,
            purpose="analyst.extract_facts",
            user_id=user.id,
            session=session,
        )
        parsed = ExtractedFacts(**result)
    except Exception:  # extraction is best-effort — never raise
        return []

    domain = parsed.domain if parsed.domain in _DOMAINS else "lifestyle"
    out: list[MemoryFact] = []
    for f in parsed.facts:
        fact = MemoryFact(
            household_id=user.household_id,
            domain=domain,
            text=f.text,
            structured=f.structured,
            confidence=f.confidence,
            sensitive=(domain == "health"),
            status="active",
            source_refs={"document_id": str(document.id)},
        )
        session.add(fact)
        out.append(fact)

    if document.domain is None:
        document.domain = domain if domain in {"finance", "health", "lifestyle"} else "other"

    await session.commit()
    return out


async def index_document_memory(
    session: AsyncSession, user: User, document: Document, llm
) -> None:
    """Index a document's text into memory chunks and extract durable facts.

    Skips silently if document.private is True, or on any error (best-effort).
    """
    if document.private:
        return
    try:
        text = (document.extracted_text or "").strip()
        if text:
            chunks = render.chunk_text(text)
            await index_chunks(
                session,
                user.household_id,
                "document",
                [(document.id, c) for c in chunks],
                llm,
            )
        await extract_facts(session, user, document, llm)
    except Exception:
        await session.rollback()


async def purge_document_memory(session: AsyncSession, household_id, document_id) -> None:
    """Delete all memory chunks and facts associated with a specific document.

    Chunks are matched by source_type=="document" and source_id==document_id.
    Facts are matched via JSONB accessor: source_refs["document_id"] == str(document_id).
    Only rows scoped to the given household_id are deleted. The caller owns the
    transaction boundary and must commit — this keeps the privacy-flag flip and
    the purge atomic in a single transaction.
    """
    await session.execute(
        _delete(_Chunk).where(
            _Chunk.household_id == household_id,
            _Chunk.source_type == "document",
            _Chunk.source_id == document_id,
        )
    )
    await session.execute(
        _delete(MemoryFact).where(
            MemoryFact.household_id == household_id,
            MemoryFact.source_refs["document_id"].astext == str(document_id),
        )
    )
