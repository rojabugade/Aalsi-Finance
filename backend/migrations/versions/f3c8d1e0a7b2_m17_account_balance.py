"""m17 account balance snapshots (net worth)

Revision ID: f3c8d1e0a7b2
Revises: e7b6c2d9a4f1
Create Date: 2026-06-15
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "f3c8d1e0a7b2"
down_revision: Union[str, None] = "e7b6c2d9a4f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "account_balance",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("household_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("as_of", sa.Date(), nullable=False),
        sa.Column("balance", sa.Numeric(18, 2), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["account_logical.id"],
            name=op.f("fk_account_balance_account_id_account_logical"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["household_id"],
            ["household.id"],
            name=op.f("fk_account_balance_household_id_household"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_account_balance")),
        sa.UniqueConstraint("account_id", "as_of", name="account_balance_account_as_of_key"),
    )
    op.create_index(
        op.f("ix_account_balance_account_id"), "account_balance", ["account_id"]
    )
    op.create_index(
        op.f("ix_account_balance_household_id"), "account_balance", ["household_id"]
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_account_balance_household_id"), table_name="account_balance")
    op.drop_index(op.f("ix_account_balance_account_id"), table_name="account_balance")
    op.drop_table("account_balance")
