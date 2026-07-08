# backend/migrations/versions/d1a2b3c4e5f6_m22_analyst_memory.py
"""m22 analyst memory: memory_chunk, memory_fact, document memory columns

Revision ID: d1a2b3c4e5f6
Revises: c7e3b9d1f4a8
"""
from __future__ import annotations

from typing import Union

import pgvector.sqlalchemy
import sqlalchemy as sa
from alembic import op

revision: str = "d1a2b3c4e5f6"
down_revision: Union[str, None] = "c7e3b9d1f4a8"
branch_labels = None
depends_on = None

_DIM = 1536  # matches settings.embed_dim default; guidance_doc uses the same


def upgrade() -> None:
    op.create_table(
        "memory_chunk",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("household_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("household.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("source_type", sa.String(), nullable=False),
        sa.Column("source_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True, index=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("embedding", pgvector.sqlalchemy.Vector(_DIM), nullable=True),
        sa.Column("meta", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("source_type IN ('document','transaction','loan','recurring','note')", name="ck_memory_chunk_source_type"),
    )
    op.create_table(
        "memory_fact",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("household_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("household.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("domain", sa.String(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("structured", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("sensitive", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("source_refs", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="active"),
        sa.Column("embedding", pgvector.sqlalchemy.Vector(_DIM), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("domain IN ('finance','health','lifestyle','goal')", name="ck_memory_fact_domain"),
        sa.CheckConstraint("status IN ('active','superseded')", name="ck_memory_fact_status"),
    )
    op.add_column("document", sa.Column("domain", sa.String(), nullable=True))
    op.add_column("document", sa.Column("private", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("document", sa.Column("extracted_text", sa.Text(), nullable=True))
    op.create_check_constraint("ck_document_domain", "document", "domain IS NULL OR domain IN ('finance','health','lifestyle','other')")


def downgrade() -> None:
    op.drop_constraint("ck_document_domain", "document", type_="check")
    op.drop_column("document", "extracted_text")
    op.drop_column("document", "private")
    op.drop_column("document", "domain")
    op.drop_table("memory_fact")
    op.drop_table("memory_chunk")
