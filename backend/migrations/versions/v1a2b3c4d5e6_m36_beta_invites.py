"""m36: closed-beta applications and one-time invite codes.

`invite_code.code_hash` holds a SHA-256 of the normalised code, never the code
itself — see app/models/beta.py for why an unsalted digest is the right choice
for a high-entropy machine-generated secret.

`redeemed_by_user_id` is ON DELETE SET NULL rather than CASCADE on purpose:
deleting an account must not delete the evidence that its code was spent, or the
code quietly becomes reusable.

Revision ID: v1a2b3c4d5e6
Revises: u0f1a2b3c4d5
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision: str = "v1a2b3c4d5e6"
down_revision: str | None = "u0f1a2b3c4d5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "beta_application",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("country", sa.String(length=2), nullable=True),
        sa.Column("how_you_track_money", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "invited",
                "declined",
                name="beta_application_status",
                native_enum=False,
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("invited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_beta_application"),
        sa.UniqueConstraint("email", name="uq_beta_application_email"),
    )

    op.create_table(
        "invite_code",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("issued_to_email", sa.String(length=320), nullable=True),
        sa.Column(
            "application_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True
        ),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("redeemed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "redeemed_by_user_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_invite_code"),
        # Unique, not merely indexed: it is what makes redemption a single
        # race-free conditional UPDATE.
        sa.UniqueConstraint("code_hash", name="uq_invite_code_code_hash"),
        sa.ForeignKeyConstraint(
            ["application_id"],
            ["beta_application.id"],
            name="fk_invite_code_application_id_beta_application",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["redeemed_by_user_id"],
            ["user.id"],
            name="fk_invite_code_redeemed_by_user_id_user",
            ondelete="SET NULL",
        ),
    )
    op.create_index(
        "ix_invite_code_issued_to_email", "invite_code", ["issued_to_email"]
    )
    op.create_index("ix_invite_code_application_id", "invite_code", ["application_id"])


def downgrade() -> None:
    op.drop_index("ix_invite_code_application_id", table_name="invite_code")
    op.drop_index("ix_invite_code_issued_to_email", table_name="invite_code")
    op.drop_table("invite_code")
    op.drop_table("beta_application")
