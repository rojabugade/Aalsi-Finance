"""m24: add 'weekly' to budget_period check constraint

Revision ID: j8e5f6a7b9c0
Revises: i7d4e5f6a8b9
"""
from alembic import op

revision = "j8e5f6a7b9c0"
down_revision = "i7d4e5f6a8b9"
branch_labels = None
depends_on = None

_OLD_VALUES = "'monthly','quarterly','yearly'"
_NEW_VALUES = "'weekly','monthly','quarterly','yearly'"


def upgrade() -> None:
    # Drop the existing CHECK constraint and recreate with 'weekly' included.
    # The constraint name follows SQLAlchemy's naming convention for enums.
    op.execute(
        f"ALTER TABLE budget DROP CONSTRAINT IF EXISTS budget_period_check"
    )
    op.execute(
        f"ALTER TABLE budget ADD CONSTRAINT budget_period_check "
        f"CHECK (period = ANY (ARRAY[{_NEW_VALUES}]::text[]))"
    )


def downgrade() -> None:
    op.execute(
        f"ALTER TABLE budget DROP CONSTRAINT IF EXISTS budget_period_check"
    )
    op.execute(
        f"ALTER TABLE budget ADD CONSTRAINT budget_period_check "
        f"CHECK (period = ANY (ARRAY[{_OLD_VALUES}]::text[]))"
    )
