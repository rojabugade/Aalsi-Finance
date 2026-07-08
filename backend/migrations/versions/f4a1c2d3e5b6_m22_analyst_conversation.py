# backend/migrations/versions/f4a1c2d3e5b6_m22_analyst_conversation.py
"""m22 analyst conversation: analyst_thread, analyst_message

Revision ID: f4a1c2d3e5b6
Revises: e2b3c4d5f6a7
"""
from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "f4a1c2d3e5b6"
down_revision: Union[str, None] = "e2b3c4d5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analyst_thread",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("household_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("household.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("household_id", "key", name="uq_analyst_thread_household_key"),
    )
    op.create_table(
        "analyst_message",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("thread_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("analyst_thread.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("role IN ('user','analyst')", name="ck_analyst_message_role"),
    )


def downgrade() -> None:
    op.drop_table("analyst_message")
    op.drop_table("analyst_thread")
