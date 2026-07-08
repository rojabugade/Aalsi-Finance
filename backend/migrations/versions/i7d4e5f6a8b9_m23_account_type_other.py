"""m23: allow 'other' account_logical.type

Revision ID: i7d4e5f6a8b9
Revises: h6c3d4e5f7a8
"""
from alembic import op

revision = "i7d4e5f6a8b9"
down_revision = "h6c3d4e5f7a8"
branch_labels = None
depends_on = None

_VALUES = "'checking','savings','credit','cash','loan','investment','other'"

def upgrade() -> None:
    op.execute("ALTER TABLE account_logical DROP CONSTRAINT IF EXISTS account_type")
    op.execute(f"ALTER TABLE account_logical ADD CONSTRAINT account_type CHECK (type IN ({_VALUES}))")

def downgrade() -> None:
    op.execute("ALTER TABLE account_logical DROP CONSTRAINT IF EXISTS account_type")
    op.execute("ALTER TABLE account_logical ADD CONSTRAINT account_type CHECK (type IN ('checking','savings','credit','cash','loan','investment'))")
