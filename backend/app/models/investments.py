"""Investment positions and point-in-time valuations."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Index, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, currency_col, fk_uuid, money, str_enum, uuid_pk


class InvestmentHolding(Base):
    __tablename__ = "investment_holding"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    owner_user_id: Mapped[uuid.UUID | None] = fk_uuid(
        ForeignKey("user.id", ondelete="SET NULL")
    )
    account_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("account_logical.id", ondelete="CASCADE"), nullable=False
    )
    asset_type: Mapped[str] = mapped_column(
        str_enum("holding_asset_type", "stock", "etf", "mutual_fund", "crypto", "bond", "other"),
        nullable=False,
    )
    symbol: Mapped[str | None] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    avg_buy_price: Mapped[Decimal | None] = money(nullable=True)
    currency: Mapped[str] = currency_col(nullable=False)


class HoldingValuation(Base):
    __tablename__ = "holding_valuation"
    __table_args__ = (Index("ix_holding_valuation_holding_as_of", "holding_id", "as_of"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    holding_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("investment_holding.id", ondelete="CASCADE"), nullable=False
    )
    as_of: Mapped[date] = mapped_column(Date, nullable=False)
    price: Mapped[Decimal] = money(nullable=False)
    value: Mapped[Decimal] = money(nullable=False)
