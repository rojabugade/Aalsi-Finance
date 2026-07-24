"""Logical accounts (labels only — never bank credentials) and Plaid items."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import (
    Base,
    TimestampMixin,
    currency_col,
    fk_uuid,
    money,
    str_enum,
    uuid_pk,
)


class AccountLogical(Base):
    __tablename__ = "account_logical"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    owner_user_id: Mapped[uuid.UUID | None] = fk_uuid(ForeignKey("user.id", ondelete="SET NULL"))
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(
        str_enum(
            "account_type",
            "checking",
            "savings",
            "credit",
            "cash",
            "loan",
            "investment",
            "other",
        ),
        nullable=False,
    )
    currency: Mapped[str] = currency_col(nullable=False)
    mask: Mapped[str | None] = mapped_column(String(16))
    plaid_item_id: Mapped[uuid.UUID | None] = fk_uuid(
        ForeignKey("plaid_item.id", ondelete="SET NULL")
    )
    plaid_account_id: Mapped[str | None] = mapped_column(String(128))


class AccountBalance(Base, TimestampMixin):
    """Point-in-time balance snapshot for a logical account.

    Net worth is derived from the latest snapshot per account: asset-type accounts
    (checking/savings/cash/investment) add, liability-type accounts (credit/loan)
    subtract. Balances are stored as positive statement magnitudes; the sign is
    applied by account type at read time. One snapshot per account per `as_of` day.
    """

    __tablename__ = "account_balance"
    __table_args__ = (
        UniqueConstraint("account_id", "as_of", name="account_balance_account_as_of_key"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    account_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("account_logical.id", ondelete="CASCADE"), index=True, nullable=False
    )
    as_of: Mapped[date] = mapped_column(Date, nullable=False)
    balance: Mapped[Decimal] = money(nullable=False)


class PaymentMethod(Base):
    """A household-visible way a transaction was funded; never credentials."""

    __tablename__ = "payment_method"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    owner_user_id: Mapped[uuid.UUID | None] = fk_uuid(
        ForeignKey("user.id", ondelete="SET NULL")
    )
    account_id: Mapped[uuid.UUID | None] = fk_uuid(
        ForeignKey("account_logical.id", ondelete="SET NULL")
    )
    type: Mapped[str] = mapped_column(
        str_enum("payment_method_type", "card", "bank", "wallet", "cash"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    last4: Mapped[str | None] = mapped_column(String(4))
    network: Mapped[str | None] = mapped_column(String(32))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class PlaidItem(Base, TimestampMixin):
    """M11a. Access token stored encrypted; never plaintext credentials."""

    __tablename__ = "plaid_item"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    access_token_encrypted: Mapped[str | None] = mapped_column(String(1024))
    institution_name: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str | None] = mapped_column(String(64))
    sync_cursor: Mapped[str | None] = mapped_column(String(512))
