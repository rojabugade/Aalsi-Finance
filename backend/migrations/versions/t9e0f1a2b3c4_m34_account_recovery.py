"""m34: email verification, password-reset tokens and MFA recovery codes.

Adds the state account recovery needs: a verified-at stamp on the user, a
single-use emailed-token table shared by password reset and email verification,
and a batch of one-time codes that substitute for TOTP.

Revision ID: t9e0f1a2b3c4
Revises: s8d9e0f1a2b3
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision: str = "t9e0f1a2b3c4"
down_revision: str | None = "s8d9e0f1a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user",
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "auth_token",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "purpose",
            sa.Enum(
                "password_reset",
                "email_verification",
                name="auth_token_purpose",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_auth_token_user_id", "auth_token", ["user_id"])
    # Redemption looks a token up by hash alone, so this index carries the flow.
    op.create_index("ix_auth_token_token_hash", "auth_token", ["token_hash"])

    op.create_table(
        "mfa_recovery_code",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("code_hash", sa.String(255), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_mfa_recovery_code_user_id", "mfa_recovery_code", ["user_id"])
    op.create_index("ix_mfa_recovery_code_code_hash", "mfa_recovery_code", ["code_hash"])


def downgrade() -> None:
    op.drop_index("ix_mfa_recovery_code_code_hash", table_name="mfa_recovery_code")
    op.drop_index("ix_mfa_recovery_code_user_id", table_name="mfa_recovery_code")
    op.drop_table("mfa_recovery_code")
    op.drop_index("ix_auth_token_token_hash", table_name="auth_token")
    op.drop_index("ix_auth_token_user_id", table_name="auth_token")
    op.drop_table("auth_token")
    op.drop_column("user", "email_verified_at")
