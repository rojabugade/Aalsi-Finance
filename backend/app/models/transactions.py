"""Transaction core: transactions, line items, merchants, categories, tags,
rules, and budgets. M6 owns the behavior; M1 just defines the shape.
"""

from __future__ import annotations

from decimal import Decimal
import uuid
from datetime import date

from sqlalchemy import (
    Boolean,
    Date,
    Float,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
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


class Category(Base):
    """Self-referential hierarchy. System categories have household_id = NULL."""

    __tablename__ = "category"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID | None] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True
    )
    parent_id: Mapped[uuid.UUID | None] = fk_uuid(ForeignKey("category.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[str] = mapped_column(
        str_enum("category_kind", "category", "subcategory", "item_type"),
        nullable=False,
        default="category",
    )
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Merchant(Base):
    """household_id NULL = global seed merchant."""

    __tablename__ = "merchant"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID | None] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True
    )
    canonical_name: Mapped[str] = mapped_column(String(255), nullable=False)
    aliases: Mapped[dict | None] = mapped_column(JSONB)
    default_category_id: Mapped[uuid.UUID | None] = fk_uuid(
        ForeignKey("category.id", ondelete="SET NULL")
    )


class RecurringSeries(Base):
    """Metadata for a repeated financial event; it never executes payments."""

    __tablename__ = "recurring_series"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    owner_user_id: Mapped[uuid.UUID | None] = fk_uuid(
        ForeignKey("user.id", ondelete="SET NULL")
    )
    merchant_id: Mapped[uuid.UUID | None] = fk_uuid(ForeignKey("merchant.id", ondelete="SET NULL"))
    category_id: Mapped[uuid.UUID | None] = fk_uuid(ForeignKey("category.id", ondelete="SET NULL"))
    account_id: Mapped[uuid.UUID | None] = fk_uuid(ForeignKey("account_logical.id", ondelete="SET NULL"))
    payment_method_id: Mapped[uuid.UUID | None] = fk_uuid(
        ForeignKey("payment_method.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    amount: Mapped[Decimal | None] = money(nullable=True)
    currency: Mapped[str] = currency_col(nullable=False)
    cadence: Mapped[str] = mapped_column(
        str_enum("recurring_cadence", "weekly", "biweekly", "monthly", "quarterly", "annual", "irregular"),
        nullable=False,
    )
    type: Mapped[str] = mapped_column(
        str_enum("recurring_type", "subscription", "bill", "income", "transfer", "other"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        str_enum("recurring_status", "active", "paused", "ended"), nullable=False, default="active"
    )
    next_due_date: Mapped[date | None] = mapped_column(Date)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)


class Transaction(Base, TimestampMixin):
    __tablename__ = "transaction"
    __table_args__ = (
        UniqueConstraint("source_channel", "external_id", name="uq_transaction_source_external"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    account_id: Mapped[uuid.UUID | None] = fk_uuid(
        ForeignKey("account_logical.id", ondelete="SET NULL")
    )
    owner_user_id: Mapped[uuid.UUID | None] = fk_uuid(ForeignKey("user.id", ondelete="SET NULL"))
    merchant_id: Mapped[uuid.UUID | None] = fk_uuid(ForeignKey("merchant.id", ondelete="SET NULL"))
    payment_method_id: Mapped[uuid.UUID | None] = fk_uuid(
        ForeignKey("payment_method.id", ondelete="SET NULL")
    )
    recurring_series_id: Mapped[uuid.UUID | None] = fk_uuid(
        ForeignKey("recurring_series.id", ondelete="SET NULL")
    )
    amount: Mapped[Decimal] = money(nullable=False)
    currency: Mapped[str] = currency_col(nullable=False)
    base_amount: Mapped[Decimal] = money(nullable=True)
    fx_rate: Mapped[float | None] = mapped_column(Numeric(18, 8))
    txn_date: Mapped[date] = mapped_column(Date, nullable=False)
    category_id: Mapped[uuid.UUID | None] = fk_uuid(ForeignKey("category.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(
        str_enum("transaction_status", "draft", "confirmed"),
        nullable=False,
        default="draft",
    )
    source_document_id: Mapped[uuid.UUID | None] = fk_uuid(
        ForeignKey("document.id", ondelete="SET NULL")
    )
    source_channel: Mapped[str | None] = mapped_column(String(32))
    flags: Mapped[dict | None] = mapped_column(JSONB)
    notes: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[float | None] = mapped_column(Float)
    external_id: Mapped[str | None] = mapped_column(String(255))


class LineItem(Base):
    __tablename__ = "line_item"

    id: Mapped[uuid.UUID] = uuid_pk()
    transaction_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("transaction.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    item_type_category_id: Mapped[uuid.UUID | None] = fk_uuid(
        ForeignKey("category.id", ondelete="SET NULL")
    )
    amount: Mapped[Decimal] = money(nullable=False)
    quantity: Mapped[float | None] = mapped_column(Numeric(18, 4))
    confidence: Mapped[float | None] = mapped_column(Float)


class Tag(Base):
    __tablename__ = "tag"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)


class TransactionTag(Base):
    __tablename__ = "transaction_tag"

    transaction_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("transaction.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[uuid.UUID] = fk_uuid(ForeignKey("tag.id", ondelete="CASCADE"), primary_key=True)


class LineItemTag(Base):
    __tablename__ = "line_item_tag"

    line_item_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("line_item.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[uuid.UUID] = fk_uuid(ForeignKey("tag.id", ondelete="CASCADE"), primary_key=True)


class Rule(Base, TimestampMixin):
    __tablename__ = "rule"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    matcher: Mapped[dict] = mapped_column(JSONB, nullable=False)
    action: Mapped[dict] = mapped_column(JSONB, nullable=False)
    priority: Mapped[int] = mapped_column(nullable=False, default=100)
    source: Mapped[str] = mapped_column(
        str_enum("rule_source", "user", "system"), nullable=False, default="user"
    )


class Budget(Base):
    __tablename__ = "budget"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    category_id: Mapped[uuid.UUID | None] = fk_uuid(ForeignKey("category.id", ondelete="SET NULL"))
    period: Mapped[str] = mapped_column(
        str_enum("budget_period", "weekly", "monthly", "quarterly", "yearly"),
        nullable=False,
        default="monthly",
    )
    amount: Mapped[Decimal] = money(nullable=False)
    currency: Mapped[str] = currency_col(nullable=False)
