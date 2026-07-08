"""Shared column types, mixins, and enums for all M1 models.

Conventions:
- Primary keys are UUIDs (`gen_random_uuid()` server-side, built into pg16).
- Enum-like fields use VARCHAR + CHECK (`native_enum=False`) for portable,
  easy-to-migrate constraints rather than native PG enums.
- Money is `NUMERIC(18,2)`; currency is a 3-letter ISO code.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum as SAEnum, MetaData, Numeric, String, func, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base  # noqa: F401  (re-exported for convenience)

# Predictable constraint/index names so Alembic diffs stay stable.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}
Base.metadata.naming_convention = MetaData(naming_convention=NAMING_CONVENTION).naming_convention


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )


def fk_uuid(*args, **kwargs) -> Mapped[uuid.UUID]:
    """A UUID foreign-key column. Pass the same args you'd pass mapped_column."""
    return mapped_column(PGUUID(as_uuid=True), *args, **kwargs)


def money(**kwargs) -> Mapped:
    return mapped_column(Numeric(18, 2), **kwargs)


def currency_col(**kwargs) -> Mapped[str]:
    return mapped_column(String(3), **kwargs)


def str_enum(name: str, *values: str, **kwargs) -> SAEnum:
    """A VARCHAR + CHECK constraint over the given string values."""
    return SAEnum(*values, name=name, native_enum=False, **kwargs)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
