"""m29: default unscoped workspace sharing to disabled

Revision ID: o3d0e1f2a4b5
Revises: n2c9d0e1f3a4
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision: str = "o3d0e1f2a4b5"
down_revision: str | None = "n2c9d0e1f3a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("household", "sharing_enabled", server_default=sa.false())


def downgrade() -> None:
    # m28 establishes the same default for fresh installations.
    pass
