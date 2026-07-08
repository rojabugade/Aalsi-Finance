"""Loans and their amortization/payment schedules (M8)."""

from __future__ import annotations

from decimal import Decimal
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, currency_col, fk_uuid, money, str_enum, uuid_pk


class Loan(Base):
    __tablename__ = "loan"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("household.id", ondelete="CASCADE"), index=True, nullable=False
    )
    owner_user_id: Mapped[uuid.UUID | None] = fk_uuid(ForeignKey("user.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(
        str_enum("loan_type", "credit_card", "personal", "auto", "education", "home", "other"),
        nullable=False,
    )
    schedule_kind: Mapped[str] = mapped_column(
        str_enum("loan_schedule_kind", "revolving", "amortizing", "emi"), nullable=False
    )
    principal: Mapped[Decimal] = money(nullable=False)
    currency: Mapped[str] = currency_col(nullable=False)
    interest_rate: Mapped[float | None] = mapped_column(Numeric(9, 4))
    # Intro/promotional APR: when set with a future promo_expiry_date, payoff sims use
    # this rate through the expiry month, then revert to interest_rate. Lets a 0%-until-
    # March card be ranked correctly (and re-ranked once the promo ends).
    promo_rate: Mapped[float | None] = mapped_column(Numeric(9, 4))
    promo_expiry_date: Mapped[date | None] = mapped_column(Date)
    compounding: Mapped[str | None] = mapped_column(
        str_enum("loan_compounding", "monthly", "daily")
    )
    min_or_emi_amount: Mapped[Decimal] = money(nullable=True)
    due_day: Mapped[int | None] = mapped_column(Integer)
    penalty_rules: Mapped[dict | None] = mapped_column(JSONB)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    # Set when this loan was created from a Plaid liabilities sync. plaid_account_id
    # is the upsert key so re-syncs refresh the same loan instead of duplicating it.
    plaid_item_id: Mapped[uuid.UUID | None] = fk_uuid(ForeignKey("plaid_item.id", ondelete="SET NULL"))
    plaid_account_id: Mapped[str | None] = mapped_column(String(255), index=True)


class PaymentSchedule(Base):
    __tablename__ = "payment_schedule"

    id: Mapped[uuid.UUID] = uuid_pk()
    loan_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("loan.id", ondelete="CASCADE"), index=True, nullable=False
    )
    installment_no: Mapped[int] = mapped_column(Integer, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    principal_component: Mapped[Decimal] = money(nullable=True)
    interest_component: Mapped[Decimal] = money(nullable=True)
    balance_after: Mapped[Decimal] = money(nullable=True)
    status: Mapped[str] = mapped_column(
        str_enum("payment_status", "due", "paid", "late"), nullable=False, default="due"
    )


class CreditCardDetail(Base):
    """One-to-one statement data for a credit-card Loan."""

    __tablename__ = "credit_card_detail"

    loan_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("loan.id", ondelete="CASCADE"), primary_key=True
    )
    credit_limit: Mapped[Decimal] = money(nullable=False)
    statement_balance: Mapped[Decimal | None] = money(nullable=True)
    available_credit: Mapped[Decimal | None] = money(nullable=True)
    statement_day: Mapped[int | None] = mapped_column(Integer)


class LoanPayment(Base):
    """A real payment recorded against a Loan. Drives schedule recompute."""

    __tablename__ = "loan_payment"

    id: Mapped[uuid.UUID] = uuid_pk()
    loan_id: Mapped[uuid.UUID] = fk_uuid(
        ForeignKey("loan.id", ondelete="CASCADE"), index=True, nullable=False
    )
    payment_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = money(nullable=False)
    interest_component: Mapped[Decimal | None] = money(nullable=True)
    principal_component: Mapped[Decimal | None] = money(nullable=True)
    balance_after: Mapped[Decimal | None] = money(nullable=True)
    note: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
