"""M2: add mfa_enabled and is_active to user.

Revision ID: b2f1c0a4d7e3
Revises: 9017a6324a24
Create Date: 2026-06-14

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b2f1c0a4d7e3"
down_revision: Union[str, None] = "9017a6324a24"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user",
        sa.Column(
            "mfa_enabled", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column(
        "user",
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
    )


def downgrade() -> None:
    op.drop_column("user", "is_active")
    op.drop_column("user", "mfa_enabled")
