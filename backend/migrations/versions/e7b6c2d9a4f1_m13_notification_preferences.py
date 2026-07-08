"""m13 notification preferences

Revision ID: e7b6c2d9a4f1
Revises: d9f0a31c8e12
Create Date: 2026-06-14
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "e7b6c2d9a4f1"
down_revision: Union[str, None] = "d9f0a31c8e12"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user",
        sa.Column("notification_preferences", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user", "notification_preferences")
