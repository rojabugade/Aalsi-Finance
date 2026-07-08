"""Bot linkage for the conversational bot (M12)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, fk_uuid, str_enum, uuid_pk


class BotLink(Base):
    __tablename__ = "bot_link"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("user.id", ondelete="CASCADE"), index=True, nullable=False
    )
    platform: Mapped[str] = mapped_column(
        str_enum("bot_platform", "telegram", "discord"), nullable=False
    )
    platform_user_id: Mapped[str | None] = mapped_column(String(128))
    token: Mapped[str | None] = mapped_column(String(255))
    consent: Mapped[dict | None] = mapped_column(JSONB)
    linked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
