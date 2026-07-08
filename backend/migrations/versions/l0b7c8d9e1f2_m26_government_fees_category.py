"""m26: global Government & Fees category

Plaid's GOVERNMENT_AND_NON_PROFIT / TAX transactions (USCIS fees, DMV, court
fees, tax payments) previously fell through to Gifts & Donations. Give them an
honest home in the system taxonomy.

Revision ID: l0b7c8d9e1f2
Revises: k9f6a7b8c0d1
Create Date: 2026-07-05
"""
from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "l0b7c8d9e1f2"
down_revision: str | None = "k9f6a7b8c0d1"
branch_labels = None
depends_on = None

# Same namespace + derivation as the m1 seed so ids stay reproducible.
_NS = uuid.UUID("00000000-0000-0000-0000-0000000c0de5")


def _cat_id(name: str) -> uuid.UUID:
    return uuid.uuid5(_NS, f"category:{name}")


_TOP = "Government & Fees"
_SUBS = ["Immigration & Visa", "Taxes & Government Payments", "Licenses & Registration"]


def upgrade() -> None:
    category = sa.table(
        "category",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("household_id", postgresql.UUID(as_uuid=True)),
        sa.column("parent_id", postgresql.UUID(as_uuid=True)),
        sa.column("name", sa.String()),
        sa.column("kind", sa.String()),
        sa.column("is_system", sa.Boolean()),
    )
    rows = [{
        "id": _cat_id(_TOP), "household_id": None, "parent_id": None,
        "name": _TOP, "kind": "category", "is_system": True,
    }]
    rows.extend({
        "id": _cat_id(f"{_TOP}/{sub}"), "household_id": None,
        "parent_id": _cat_id(_TOP), "name": sub,
        "kind": "subcategory", "is_system": True,
    } for sub in _SUBS)
    op.bulk_insert(category, rows)


def downgrade() -> None:
    # category_id FKs are ON DELETE SET NULL (parent_id cascades), so a plain
    # delete detaches transactions/budgets/merchants cleanly.
    ids = [str(_cat_id(f"{_TOP}/{sub}")) for sub in _SUBS] + [str(_cat_id(_TOP))]
    op.execute(
        sa.text("DELETE FROM category WHERE id = ANY(CAST(:ids AS uuid[]))").bindparams(ids=ids)
    )
