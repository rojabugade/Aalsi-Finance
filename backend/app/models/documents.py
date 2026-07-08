"""Uploaded documents and their processing lifecycle (M4/M5 own the pipeline)."""

from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, fk_uuid, str_enum, uuid_pk


class Document(Base, TimestampMixin):
    __tablename__ = "document"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    uploaded_by_user_id: Mapped[uuid.UUID | None] = fk_uuid(
        ForeignKey("user.id", ondelete="SET NULL")
    )
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    type: Mapped[str] = mapped_column(
        str_enum(
            "document_type",
            "receipt",
            "statement",
            "paystub",
            "invoice",
            "csv",
            "loan",
            "other",
        ),
        nullable=False,
    )
    source_channel: Mapped[str] = mapped_column(
        str_enum(
            "document_source_channel",
            "upload",
            "email",
            "sms",
            "bot",
            "plaid",
            "manual",
            "splitwise",
        ),
        nullable=False,
        default="upload",
    )
    status: Mapped[str] = mapped_column(
        str_enum(
            "document_status",
            "uploaded",
            "processing",
            "needs_review",
            "processed",
            "failed",
        ),
        nullable=False,
        default="uploaded",
    )
    ocr_meta: Mapped[dict | None] = mapped_column(JSONB)
    domain: Mapped[str | None] = mapped_column(
        str_enum("document_domain", "finance", "health", "lifestyle", "other")
    )
    private: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    extracted_text: Mapped[str | None] = mapped_column(Text)
