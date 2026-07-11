"""m30: persist guidance plan items and analyst message payloads

Revision ID: p4e1f2a3b5c6
Revises: o3d0e1f2a4b5
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "p4e1f2a3b5c6"
down_revision: str | None = "o3d0e1f2a4b5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "guidance_plan_item",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("household_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "domain",
            sa.Enum(
                "general",
                "investment",
                "cross_border",
                name="guidance_plan_item_domain",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "open",
                "completed",
                "dismissed",
                name="guidance_plan_item_status",
                native_enum=False,
            ),
            server_default="open",
            nullable=False,
        ),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("source_refs", postgresql.JSONB(), nullable=True),
        sa.Column("origin_thread_key", sa.String(length=96), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "domain IN ('general', 'investment', 'cross_border')",
            name="ck_guidance_plan_item_domain",
        ),
        sa.CheckConstraint(
            "status IN ('open', 'completed', 'dismissed')",
            name="ck_guidance_plan_item_status",
        ),
        sa.ForeignKeyConstraint(
            ["household_id"],
            ["household.id"],
            name=op.f("fk_guidance_plan_item_household_id_household"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user.id"],
            name=op.f("fk_guidance_plan_item_user_id_user"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_guidance_plan_item")),
    )
    op.create_index(
        op.f("ix_guidance_plan_item_household_id"),
        "guidance_plan_item",
        ["household_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_guidance_plan_item_user_id"),
        "guidance_plan_item",
        ["user_id"],
        unique=False,
    )
    op.add_column(
        "analyst_message",
        sa.Column("payload", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("analyst_message", "payload")
    op.drop_index(
        op.f("ix_guidance_plan_item_user_id"),
        table_name="guidance_plan_item",
    )
    op.drop_index(
        op.f("ix_guidance_plan_item_household_id"),
        table_name="guidance_plan_item",
    )
    op.drop_table("guidance_plan_item")
