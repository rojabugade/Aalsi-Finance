"""m27: promotional/intro APR columns on loan

Adds promo_rate + promo_expiry_date so a card carrying a 0%-until-March intro APR
is ranked (and re-ranked, once the promo ends) correctly by the payoff sims.

Revision ID: m1c8d9e0f2a3
Revises: l0b7c8d9e1f2
Create Date: 2026-07-05
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "m1c8d9e0f2a3"
down_revision: str | None = "l0b7c8d9e1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("loan", sa.Column("promo_rate", sa.Numeric(9, 4), nullable=True))
    op.add_column("loan", sa.Column("promo_expiry_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("loan", "promo_expiry_date")
    op.drop_column("loan", "promo_rate")
