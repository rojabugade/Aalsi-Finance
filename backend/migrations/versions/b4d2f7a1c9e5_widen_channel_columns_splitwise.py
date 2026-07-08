"""widen channel columns to fit 'splitwise'

The channel/source_channel columns are VARCHAR sized to the longest enum
value at creation time (5-6 chars). Adding the "splitwise" value (9 chars)
overflows them, so widen the three affected columns.

Revision ID: b4d2f7a1c9e5
Revises: a1b2c3d4e5f6
Create Date: 2026-06-22
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b4d2f7a1c9e5"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("ingestion_connection", "channel", type_=sa.String(length=32))
    op.alter_column("consent_record", "channel", type_=sa.String(length=32))
    op.alter_column("document", "source_channel", type_=sa.String(length=32))


def downgrade() -> None:
    op.alter_column("ingestion_connection", "channel", type_=sa.String(length=5))
    op.alter_column("consent_record", "channel", type_=sa.String(length=5))
    op.alter_column("document", "source_channel", type_=sa.String(length=6))
