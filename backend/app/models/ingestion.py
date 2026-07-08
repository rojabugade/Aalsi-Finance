"""Encrypted external-ingestion connections for M11 email/SMS."""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, fk_uuid, str_enum, uuid_pk


class IngestionConnection(Base, TimestampMixin):
    __tablename__ = "ingestion_connection"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("user.id", ondelete="CASCADE"), index=True, nullable=False
    )
    channel: Mapped[str] = mapped_column(
        str_enum("ingestion_connection_channel", "email", "sms", "splitwise"), nullable=False
    )
    provider: Mapped[str | None] = mapped_column(String(64))
    token_encrypted: Mapped[str | None] = mapped_column(String(2048))
    config: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(64), nullable=False, default="active")
