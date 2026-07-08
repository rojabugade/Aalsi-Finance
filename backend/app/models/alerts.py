"""Persistent, stateful analyst alerts (W2). Replaces the frontend localStorage
dismissal: alerts live server-side, can be acknowledged (still visible) but never
user-hidden, and auto-resolve when their producing condition stops re-emitting
their signature. The ORM class is AnalystAlertRow to avoid clashing with the
pydantic app.analyst.schemas.AnalystAlert."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, fk_uuid, str_enum, uuid_pk


class AnalystAlertRow(Base):
    __tablename__ = "analyst_alert"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    producer: Mapped[str] = mapped_column(String(32), nullable=False, default="deterministic")
    severity: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    tone: Mapped[str] = mapped_column(
        str_enum("analyst_alert_tone", "positive", "info", "warning", "danger"),
        nullable=False, default="info",
    )
    signature: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    state: Mapped[str] = mapped_column(
        str_enum("analyst_alert_state", "active", "acknowledged", "resolved"),
        nullable=False, default="active",
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    suggested_action: Mapped[dict | None] = mapped_column(JSONB)
    supporting_refs: Mapped[list | None] = mapped_column(JSONB)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
