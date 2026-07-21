"""RAG guidance corpus (M10), recommendations, and notifications (M13).

`guidance_doc.embedding` dimension is driven by settings.embed_dim and MUST
match the embedding model chosen in M3 (default 1536).
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.config import get_settings
from app.models.base import Base, TimestampMixin, fk_uuid, str_enum, uuid_pk

_EMBED_DIM = get_settings().embed_dim


class GuidanceDoc(Base):
    __tablename__ = "guidance_doc"

    id: Mapped[uuid.UUID] = uuid_pk()
    country: Mapped[str | None] = mapped_column(String(2))
    topic: Mapped[str | None] = mapped_column(String(128))
    # An explicit retrieval boundary.  Topic is descriptive metadata, not an
    # authorization/relevance boundary, so do not infer domain at query time.
    domain: Mapped[str] = mapped_column(String(32), nullable=False, default="general", server_default="general")
    title: Mapped[str | None] = mapped_column(String(512))
    body: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(String(1024))
    source_type: Mapped[str | None] = mapped_column(
        str_enum("guidance_source_type", "govt", "community", "other")
    )
    effective_date: Mapped[date | None] = mapped_column(Date)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(_EMBED_DIM))


class GuidancePlanItem(Base):
    __tablename__ = "guidance_plan_item"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("user.id", ondelete="CASCADE"), index=True, nullable=False
    )
    domain: Mapped[str] = mapped_column(
        str_enum(
            "guidance_plan_item_domain",
            "general",
            "investment",
            "cross_border",
        ),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    rationale: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        str_enum(
            "guidance_plan_item_status",
            "open",
            "completed",
            "dismissed",
        ),
        nullable=False,
        default="open",
        server_default="open",
    )
    due_date: Mapped[date | None] = mapped_column(Date)
    source_refs: Mapped[list[dict] | None] = mapped_column(JSONB)
    origin_thread_key: Mapped[str | None] = mapped_column(String(96))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Recommendation(Base):
    __tablename__ = "recommendation"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[uuid.UUID | None] = fk_uuid(ForeignKey("user.id", ondelete="SET NULL"))
    type: Mapped[str] = mapped_column(String(128), nullable=False)
    payload: Mapped[dict | None] = mapped_column(JSONB)
    supporting_refs: Mapped[dict | None] = mapped_column(JSONB)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dismissed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Notification(Base):
    __tablename__ = "notification"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[uuid.UUID | None] = fk_uuid(ForeignKey("user.id", ondelete="SET NULL"))
    type: Mapped[str] = mapped_column(String(128), nullable=False)
    channel: Mapped[str] = mapped_column(
        str_enum("notification_channel", "push", "email", "inapp", "bot"), nullable=False
    )
    payload: Mapped[dict | None] = mapped_column(JSONB)
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(
        str_enum("notification_status", "pending", "sent", "failed", "read"),
        nullable=False,
        default="pending",
    )
