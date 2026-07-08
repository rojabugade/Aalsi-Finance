"""add temporary household LLM configuration

Revision ID: 6c31f8e2a9d4
Revises: a8d4e6f19c22
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "6c31f8e2a9d4"
down_revision: Union[str, None] = "a8d4e6f19c22"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("household", sa.Column("llm_config", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("household", "llm_config")
