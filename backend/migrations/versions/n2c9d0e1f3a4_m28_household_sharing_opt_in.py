"""m28: make household sharing an explicit opt-in

Every account retains an internal household for tenant isolation, but the
household-management experience is hidden until its owner enables sharing.

Revision ID: n2c9d0e1f3a4
Revises: m1c8d9e0f2a3
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision: str = "n2c9d0e1f3a4"
down_revision: str | None = "m1c8d9e0f2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "household",
        sa.Column("sharing_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Existing workspaces with multiple members are already being used as
    # households, so retain their visible sharing state.
    op.execute(
        """
        UPDATE household
        SET sharing_enabled = true
        WHERE EXISTS (
            SELECT 1
            FROM \"user\"
            WHERE \"user\".household_id = household.id
            GROUP BY \"user\".household_id
            HAVING COUNT(*) > 1
        )
        """
    )
def downgrade() -> None:
    op.drop_column("household", "sharing_enabled")
