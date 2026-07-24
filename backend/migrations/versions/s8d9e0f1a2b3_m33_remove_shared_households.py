"""m33: remove shared-household state and collapse legacy memberships.

Each account now owns one private workspace.  For a legacy workspace with more
than one active user, retain the earliest owner (or earliest user if no owner is
available), revoke/deactivate the other accounts, and transfer operational record
ownership to the retained account before removing sharing-specific columns.

Revision ID: s8d9e0f1a2b3
Revises: r7c8d9e0f1a2
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision: str = "s8d9e0f1a2b3"
down_revision: str | None = "r7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Materialise one retained user per workspace. PostgreSQL is the supported
    # production database, and DISTINCT ON makes the owner-preferred rule clear.
    op.execute(
        """
        CREATE TEMPORARY TABLE _workspace_keeper ON COMMIT DROP AS
        SELECT DISTINCT ON (household_id) household_id, id AS user_id
        FROM "user"
        ORDER BY household_id, (role = 'owner') DESC, created_at, id
        """
    )

    # Keep operational ownership and notification delivery bound to the retained
    # account; audit and consent histories intentionally preserve their actors.
    for table, column in (
        ("account_logical", "owner_user_id"),
        ("payment_method", "owner_user_id"),
        ("recurring_series", "owner_user_id"),
        ("transaction", "owner_user_id"),
        ("loan", "owner_user_id"),
        ("income_source", "owner_user_id"),
        ("cross_border_transfer", "owner_user_id"),
        ("investment_holding", "owner_user_id"),
        ("document", "uploaded_by_user_id"),
        ("notification", "user_id"),
        ("recommendation", "user_id"),
    ):
        op.execute(
            sa.text(
                f"""
                UPDATE "{table}" AS row
                SET {column} = keeper.user_id
                FROM _workspace_keeper AS keeper
                WHERE row.household_id = keeper.household_id
                  AND row.{column} IS DISTINCT FROM keeper.user_id
                """
            )
        )

    op.execute(
        """
        UPDATE refresh_token AS token
        SET revoked = true
        FROM "user" AS member
        JOIN _workspace_keeper AS keeper ON keeper.household_id = member.household_id
        WHERE token.user_id = member.id AND member.id <> keeper.user_id
        """
    )
    op.execute(
        """
        UPDATE "user" AS member
        SET is_active = false
        FROM _workspace_keeper AS keeper
        WHERE member.household_id = keeper.household_id AND member.id <> keeper.user_id
        """
    )

    op.drop_column("account_logical", "is_shared")
    op.drop_column("transaction", "is_shared")
    op.drop_column("household", "sharing_enabled")
    op.drop_column("user", "role")


def downgrade() -> None:
    op.add_column(
        "user",
        sa.Column(
            "role",
            sa.Enum("owner", "member", "viewer", name="user_role", native_enum=False),
            nullable=False,
            server_default="owner",
        ),
    )
    op.add_column(
        "household",
        sa.Column("sharing_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "transaction",
        sa.Column("is_shared", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "account_logical",
        sa.Column("is_shared", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
