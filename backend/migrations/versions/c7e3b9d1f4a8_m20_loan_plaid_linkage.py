"""link loans to plaid items for liabilities sync

Adds plaid_item_id / plaid_account_id to loan so a liabilities sync can upsert
credit-card/student/mortgage accounts into the Debt page without duplicating on
re-sync. plaid_account_id is the idempotency key.

Revision ID: c7e3b9d1f4a8
Revises: b4d2f7a1c9e5
Create Date: 2026-06-22
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c7e3b9d1f4a8"
down_revision: Union[str, None] = "b4d2f7a1c9e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("loan", sa.Column("plaid_item_id", sa.Uuid(), nullable=True))
    op.add_column("loan", sa.Column("plaid_account_id", sa.String(length=255), nullable=True))
    op.create_foreign_key(
        "fk_loan_plaid_item_id", "loan", "plaid_item", ["plaid_item_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index("ix_loan_plaid_account_id", "loan", ["plaid_account_id"])


def downgrade() -> None:
    op.drop_index("ix_loan_plaid_account_id", table_name="loan")
    op.drop_constraint("fk_loan_plaid_item_id", "loan", type_="foreignkey")
    op.drop_column("loan", "plaid_account_id")
    op.drop_column("loan", "plaid_item_id")
