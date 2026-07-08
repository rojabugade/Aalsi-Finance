"""m22 analyst memory: expand structured source types

Revision ID: h6c3d4e5f7a8
Revises: g5b2d3e4f6c7
"""
from __future__ import annotations

from typing import Union

from alembic import op

revision: str = "h6c3d4e5f7a8"
down_revision: Union[str, None] = "g5b2d3e4f6c7"
branch_labels = None
depends_on = None

OLD_TYPES = "'document','transaction','loan','recurring','note'"
NEW_TYPES = (
    "'document','transaction','loan','recurring','note',"
    "'account','account_balance','payment_method','budget','merchant','category','tag','rule',"
    "'income_source','investment_holding','holding_valuation'"
)


def upgrade() -> None:
    op.drop_constraint("ck_memory_chunk_source_type", "memory_chunk", type_="check")
    op.create_check_constraint(
        "ck_memory_chunk_source_type",
        "memory_chunk",
        f"source_type IN ({NEW_TYPES})",
    )


def downgrade() -> None:
    op.execute(f"DELETE FROM memory_chunk WHERE source_type NOT IN ({OLD_TYPES})")
    op.drop_constraint("ck_memory_chunk_source_type", "memory_chunk", type_="check")
    op.create_check_constraint(
        "ck_memory_chunk_source_type",
        "memory_chunk",
        f"source_type IN ({OLD_TYPES})",
    )
