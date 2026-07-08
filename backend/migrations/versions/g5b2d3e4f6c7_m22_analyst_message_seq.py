# backend/migrations/versions/g5b2d3e4f6c7_m22_analyst_message_seq.py
"""m22 analyst_message: add seq bigserial for stable intra-turn ordering

Revision ID: g5b2d3e4f6c7
Revises: f4a1c2d3e5b6
"""
from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "g5b2d3e4f6c7"
down_revision: Union[str, None] = "f4a1c2d3e5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "analyst_message",
        sa.Column(
            "seq",
            sa.BigInteger(),
            sa.Identity(always=True),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("analyst_message", "seq")
