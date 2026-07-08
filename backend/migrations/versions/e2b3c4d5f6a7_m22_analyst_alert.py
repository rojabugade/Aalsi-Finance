"""m22 analyst alert: persistent stateful alerts table

Revision ID: e2b3c4d5f6a7
Revises: d1a2b3c4e5f6
"""
from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "e2b3c4d5f6a7"
down_revision: Union[str, None] = "d1a2b3c4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analyst_alert",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("household_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("household.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("producer", sa.String(length=32), nullable=False, server_default="deterministic"),
        sa.Column("severity", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("tone", sa.String(), nullable=False, server_default="info"),
        sa.Column("signature", sa.String(length=255), nullable=False, index=True),
        sa.Column("state", sa.String(), nullable=False, server_default="active"),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("suggested_action", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("supporting_refs", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("tone IN ('positive','info','warning','danger')", name="ck_analyst_alert_tone"),
        sa.CheckConstraint("state IN ('active','acknowledged','resolved')", name="ck_analyst_alert_state"),
    )
    op.create_index("ix_analyst_alert_hh_sig", "analyst_alert", ["household_id", "signature"])


def downgrade() -> None:
    op.drop_index("ix_analyst_alert_hh_sig", table_name="analyst_alert")
    op.drop_table("analyst_alert")
