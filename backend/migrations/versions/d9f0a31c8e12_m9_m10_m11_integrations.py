"""m9 m10 m11 integration persistence

Revision ID: d9f0a31c8e12
Revises: c4e7a1b9f2d8
Create Date: 2026-06-14
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "d9f0a31c8e12"
down_revision: Union[str, None] = "c4e7a1b9f2d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("plaid_item", sa.Column("sync_cursor", sa.String(length=512), nullable=True))
    op.create_table(
        "ingestion_connection",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column(
            "channel",
            sa.Enum("email", "sms", name="ingestion_connection_channel", native_enum=False),
            nullable=False,
        ),
        sa.Column("provider", sa.String(length=64), nullable=True),
        sa.Column("token_encrypted", sa.String(length=2048), nullable=True),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ingestion_connection_user_id", "ingestion_connection", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_ingestion_connection_user_id", table_name="ingestion_connection")
    op.drop_table("ingestion_connection")
    op.drop_column("plaid_item", "sync_cursor")
