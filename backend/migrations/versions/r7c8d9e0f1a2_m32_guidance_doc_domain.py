"""m32: add explicit guidance retrieval domains

Revision ID: r7c8d9e0f1a2
Revises: q5f2a3b4c6d7
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision: str = "r7c8d9e0f1a2"
down_revision: str | None = "q5f2a3b4c6d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "guidance_doc",
        sa.Column("domain", sa.String(length=32), nullable=False, server_default="general"),
    )
    # Existing corpus rows have only topic metadata.  Seed the explicit boundary
    # conservatively, then ensure future reindexing writes the value directly.
    op.execute(
        """
        UPDATE guidance_doc
        SET domain = 'cross_border'
        WHERE lower(coalesce(topic, '')) LIKE ANY (ARRAY[
            '%cross-border%', '%cross border%', '%remittance%', '%tax-reporting%',
            '%tax reporting%', '%foreign tax%', '%foreign account%',
            '%double taxation%', '%dtaa%', '%fbar%', '%fatca%'
        ])
        """
    )
    op.execute(
        """
        UPDATE guidance_doc
        SET domain = 'investment'
        WHERE domain = 'general' AND lower(coalesce(topic, '')) LIKE '%investment%'
        """
    )
    op.create_index("ix_guidance_doc_domain", "guidance_doc", ["domain"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_guidance_doc_domain", table_name="guidance_doc")
    op.drop_column("guidance_doc", "domain")
