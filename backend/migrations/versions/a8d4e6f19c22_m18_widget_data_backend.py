"""m18 widget data backend

Revision ID: a8d4e6f19c22
Revises: f3c8d1e0a7b2
Create Date: 2026-06-19
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "a8d4e6f19c22"
down_revision: Union[str, None] = "f3c8d1e0a7b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def _id() -> sa.Column:
    return sa.Column("id", UUID, server_default=sa.text("gen_random_uuid()"), nullable=False)


def upgrade() -> None:
    op.create_table(
        "payment_method",
        _id(),
        sa.Column("household_id", UUID, nullable=False),
        sa.Column("owner_user_id", UUID),
        sa.Column("account_id", UUID),
        sa.Column("type", sa.Enum("card", "bank", "wallet", "cash", name="payment_method_type"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("last4", sa.String(4)),
        sa.Column("network", sa.String(32)),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.ForeignKeyConstraint(["household_id"], ["household.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["account_id"], ["account_logical.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_payment_method_household_id"), "payment_method", ["household_id"])

    op.create_table(
        "credit_card_detail",
        sa.Column("loan_id", UUID, nullable=False),
        sa.Column("credit_limit", sa.Numeric(18, 2), nullable=False),
        sa.Column("statement_balance", sa.Numeric(18, 2)),
        sa.Column("available_credit", sa.Numeric(18, 2)),
        sa.Column("statement_day", sa.Integer()),
        sa.ForeignKeyConstraint(["loan_id"], ["loan.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("loan_id"),
    )

    op.create_table(
        "investment_holding",
        _id(),
        sa.Column("household_id", UUID, nullable=False),
        sa.Column("owner_user_id", UUID),
        sa.Column("account_id", UUID, nullable=False),
        sa.Column("asset_type", sa.Enum("stock", "etf", "mutual_fund", "crypto", "bond", "other", name="holding_asset_type"), nullable=False),
        sa.Column("symbol", sa.String(32)),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 4), nullable=False),
        sa.Column("avg_buy_price", sa.Numeric(18, 2)),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.ForeignKeyConstraint(["household_id"], ["household.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["account_id"], ["account_logical.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_investment_holding_household_id"), "investment_holding", ["household_id"])

    op.create_table(
        "holding_valuation",
        _id(),
        sa.Column("household_id", UUID, nullable=False),
        sa.Column("holding_id", UUID, nullable=False),
        sa.Column("as_of", sa.Date(), nullable=False),
        sa.Column("price", sa.Numeric(18, 2), nullable=False),
        sa.Column("value", sa.Numeric(18, 2), nullable=False),
        sa.ForeignKeyConstraint(["household_id"], ["household.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["holding_id"], ["investment_holding.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_holding_valuation_household_id"), "holding_valuation", ["household_id"])
    op.create_index("ix_holding_valuation_holding_as_of", "holding_valuation", ["holding_id", "as_of"])

    op.create_table(
        "recurring_series",
        _id(),
        sa.Column("household_id", UUID, nullable=False),
        sa.Column("owner_user_id", UUID),
        sa.Column("merchant_id", UUID),
        sa.Column("category_id", UUID),
        sa.Column("account_id", UUID),
        sa.Column("payment_method_id", UUID),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2)),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("cadence", sa.Enum("weekly", "biweekly", "monthly", "quarterly", "annual", "irregular", name="recurring_cadence"), nullable=False),
        sa.Column("type", sa.Enum("subscription", "bill", "income", "transfer", "other", name="recurring_type"), nullable=False),
        sa.Column("status", sa.Enum("active", "paused", "ended", name="recurring_status"), server_default="active", nullable=False),
        sa.Column("next_due_date", sa.Date()),
        sa.Column("start_date", sa.Date()),
        sa.Column("end_date", sa.Date()),
        sa.ForeignKeyConstraint(["household_id"], ["household.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["merchant_id"], ["merchant.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["category_id"], ["category.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["account_id"], ["account_logical.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["payment_method_id"], ["payment_method.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_recurring_series_household_id"), "recurring_series", ["household_id"])

    op.add_column("transaction", sa.Column("payment_method_id", UUID))
    op.add_column("transaction", sa.Column("recurring_series_id", UUID))
    op.create_foreign_key(op.f("fk_transaction_payment_method_id_payment_method"), "transaction", "payment_method", ["payment_method_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key(op.f("fk_transaction_recurring_series_id_recurring_series"), "transaction", "recurring_series", ["recurring_series_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint(op.f("fk_transaction_recurring_series_id_recurring_series"), "transaction", type_="foreignkey")
    op.drop_constraint(op.f("fk_transaction_payment_method_id_payment_method"), "transaction", type_="foreignkey")
    op.drop_column("transaction", "recurring_series_id")
    op.drop_column("transaction", "payment_method_id")
    op.drop_index(op.f("ix_recurring_series_household_id"), table_name="recurring_series")
    op.drop_table("recurring_series")
    op.drop_index("ix_holding_valuation_holding_as_of", table_name="holding_valuation")
    op.drop_index(op.f("ix_holding_valuation_household_id"), table_name="holding_valuation")
    op.drop_table("holding_valuation")
    op.drop_index(op.f("ix_investment_holding_household_id"), table_name="investment_holding")
    op.drop_table("investment_holding")
    op.drop_table("credit_card_detail")
    op.drop_index(op.f("ix_payment_method_household_id"), table_name="payment_method")
    op.drop_table("payment_method")
    for enum_name in ("recurring_status", "recurring_type", "recurring_cadence", "holding_asset_type", "payment_method_type"):
        sa.Enum(name=enum_name).drop(op.get_bind(), checkfirst=True)
