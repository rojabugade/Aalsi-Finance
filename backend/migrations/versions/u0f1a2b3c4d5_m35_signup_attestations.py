"""m35: record the age and terms attestations captured at signup.

Both gates are enforced in the API, but enforcement alone leaves no evidence.
These stamps are the record that a given account confirmed it met the minimum
age and accepted the terms, and when.

Existing rows predate the gate, so both columns stay nullable: a NULL means
"never attested", which is exactly true of accounts created before this ran.

Revision ID: u0f1a2b3c4d5
Revises: t9e0f1a2b3c4
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision: str = "u0f1a2b3c4d5"
down_revision: str | None = "t9e0f1a2b3c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user",
        sa.Column("age_confirmed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "user",
        sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user", "terms_accepted_at")
    op.drop_column("user", "age_confirmed_at")
