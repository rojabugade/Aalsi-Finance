"""m31: widen analyst thread keys for user-prefixed guidance keys

Revision ID: q5f2a3b4c6d7
Revises: p4e1f2a3b5c6
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision: str = "q5f2a3b4c6d7"
down_revision: str | None = "p4e1f2a3b5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "analyst_thread",
        "key",
        existing_type=sa.String(length=128),
        type_=sa.String(length=160),
        existing_nullable=False,
    )


def downgrade() -> None:
    # Keep the backward-compatible widening in place. Guidance keys written
    # after this migration may exceed 128 characters, so narrowing here would
    # either fail the rollback or require destructive truncation.
    pass
