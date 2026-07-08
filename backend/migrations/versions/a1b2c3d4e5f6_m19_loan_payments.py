"""m19 loan payments ledger

Revision ID: a1b2c3d4e5f6
Revises: 6c31f8e2a9d4
Create Date: 2026-06-21
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "6c31f8e2a9d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "loan_payment",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("loan_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("payment_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("interest_component", sa.Numeric(18, 2), nullable=True),
        sa.Column("principal_component", sa.Numeric(18, 2), nullable=True),
        sa.Column("balance_after", sa.Numeric(18, 2), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["loan_id"],
            ["loan.id"],
            name=op.f("fk_loan_payment_loan_id_loan"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_loan_payment")),
    )
    op.create_index(op.f("ix_loan_payment_loan_id"), "loan_payment", ["loan_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_loan_payment_loan_id"), table_name="loan_payment")
    op.drop_table("loan_payment")
