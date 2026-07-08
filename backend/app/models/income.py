"""Income sources, paystubs, and equity grants/events (M9)."""

from __future__ import annotations

from decimal import Decimal
import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, currency_col, fk_uuid, money, str_enum, uuid_pk


class IncomeSource(Base):
    __tablename__ = "income_source"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    owner_user_id: Mapped[uuid.UUID | None] = fk_uuid(ForeignKey("user.id", ondelete="SET NULL"))
    employer: Mapped[str | None] = mapped_column(String(255))
    country: Mapped[str | None] = mapped_column(String(2))
    currency: Mapped[str] = currency_col(nullable=False)
    frequency: Mapped[str] = mapped_column(
        str_enum(
            "income_frequency",
            "weekly",
            "biweekly",
            "semimonthly",
            "monthly",
            "annual",
        ),
        nullable=False,
        default="monthly",
    )
    gross: Mapped[Decimal] = money(nullable=True)
    net: Mapped[Decimal] = money(nullable=True)
    withholding: Mapped[dict | None] = mapped_column(JSONB)


class Paystub(Base):
    __tablename__ = "paystub"

    id: Mapped[uuid.UUID] = uuid_pk()
    income_source_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("income_source.id", ondelete="CASCADE"), index=True, nullable=False
    )
    source_document_id: Mapped[uuid.UUID | None] = fk_uuid(
        ForeignKey("document.id", ondelete="SET NULL")
    )
    period_start: Mapped[date | None] = mapped_column(Date)
    period_end: Mapped[date | None] = mapped_column(Date)
    gross: Mapped[Decimal] = money(nullable=True)
    deductions: Mapped[dict | None] = mapped_column(JSONB)
    net: Mapped[Decimal] = money(nullable=True)


class EquityGrant(Base):
    __tablename__ = "equity_grant"

    id: Mapped[uuid.UUID] = uuid_pk()
    income_source_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("income_source.id", ondelete="CASCADE"), index=True, nullable=False
    )
    type: Mapped[str] = mapped_column(
        str_enum("equity_grant_type", "rsu", "espp", "iso", "nso"), nullable=False
    )
    ticker: Mapped[str | None] = mapped_column(String(16))
    country: Mapped[str | None] = mapped_column(String(2))
    grant_date: Mapped[date | None] = mapped_column(Date)
    shares: Mapped[float | None] = mapped_column(Numeric(18, 4))
    strike_price: Mapped[Decimal] = money(nullable=True)
    vesting_schedule: Mapped[dict | None] = mapped_column(JSONB)


class EquityEvent(Base):
    __tablename__ = "equity_event"

    id: Mapped[uuid.UUID] = uuid_pk()
    equity_grant_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("equity_grant.id", ondelete="CASCADE"), index=True, nullable=False
    )
    type: Mapped[str] = mapped_column(
        str_enum("equity_event_type", "vest", "purchase", "sale"), nullable=False
    )
    event_date: Mapped[date | None] = mapped_column(Date)
    shares: Mapped[float | None] = mapped_column(Numeric(18, 4))
    fmv: Mapped[Decimal] = money(nullable=True)
    proceeds: Mapped[Decimal] = money(nullable=True)
    est_tax: Mapped[dict | None] = mapped_column(JSONB)
