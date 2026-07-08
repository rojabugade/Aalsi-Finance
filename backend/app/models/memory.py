# backend/app/models/memory.py
"""Analyst long-term memory: a unified pgvector chunk index plus durable
learned facts. Embedding dim is driven by settings.embed_dim (M3) and MUST
match the guidance_doc embedding dim — see app/models/guidance.py."""

from __future__ import annotations

import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.config import get_settings
from app.models.base import Base, TimestampMixin, fk_uuid, str_enum, uuid_pk

_EMBED_DIM = get_settings().embed_dim


class MemoryChunk(Base):
    __tablename__ = "memory_chunk"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    source_type: Mapped[str] = mapped_column(
        str_enum(
            "memory_source_type",
            "document",
            "transaction",
            "loan",
            "recurring",
            "note",
            "account",
            "account_balance",
            "payment_method",
            "budget",
            "merchant",
            "category",
            "tag",
            "rule",
            "income_source",
            "investment_holding",
            "holding_valuation",
        ),
        nullable=False,
    )
    source_id: Mapped[uuid.UUID | None] = fk_uuid(nullable=True, index=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(_EMBED_DIM))
    meta: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class MemoryFact(Base, TimestampMixin):
    __tablename__ = "memory_fact"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    domain: Mapped[str] = mapped_column(
        str_enum("memory_fact_domain", "finance", "health", "lifestyle", "goal"), nullable=False
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    structured: Mapped[dict | None] = mapped_column(JSONB)
    confidence: Mapped[float | None] = mapped_column(Float)
    sensitive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    source_refs: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(
        str_enum("memory_fact_status", "active", "superseded"), nullable=False, default="active"
    )
    embedding: Mapped[list[float] | None] = mapped_column(Vector(_EMBED_DIM))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
