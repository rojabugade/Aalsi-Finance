"""FX rates and cross-border transfers (M14)."""

from __future__ import annotations

from decimal import Decimal
import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, currency_col, fk_uuid, money, str_enum, uuid_pk


class FXRate(Base):
    """Composite PK (currency_pair, date), e.g. ('USD/INR', 2026-06-14)."""

    __tablename__ = "fx_rate"

    currency_pair: Mapped[str] = mapped_column(String(7), primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    rate: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False)


class CrossBorderTransfer(Base):
    __tablename__ = "cross_border_transfer"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    owner_user_id: Mapped[uuid.UUID | None] = fk_uuid(ForeignKey("user.id", ondelete="SET NULL"))
    direction: Mapped[str] = mapped_column(
        str_enum("transfer_direction", "out", "in"), nullable=False
    )
    from_currency: Mapped[str] = currency_col(nullable=False)
    to_currency: Mapped[str] = currency_col(nullable=False)
    amount: Mapped[Decimal] = money(nullable=False)
    fx_rate: Mapped[Decimal] = mapped_column(Numeric(18, 8))
    purpose: Mapped[str | None] = mapped_column(String(255))
    channel: Mapped[str | None] = mapped_column(String(128))
    transfer_date: Mapped[date | None] = mapped_column(Date)
