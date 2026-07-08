"""m7 analytics monthly rollup materialized view

Maintains `mv_household_monthly`: confirmed-transaction spend/income/count rolled up
per (household, month, category, merchant, currency). Refreshed on transaction confirm
(see app.analytics.service.refresh_rollups) so month-aligned summary/timeseries queries
read a small pre-aggregated table instead of scanning every transaction.

Income classification mirrors the live path exactly: a row is income when its base
amount is negative OR flags->>'type' = 'income'; income_total stores the absolute value.

Revision ID: c4e7a1b9f2d8
Revises: b2f1c0a4d7e3
Create Date: 2026-06-14
"""

from alembic import op

revision = "c4e7a1b9f2d8"
down_revision = "b2f1c0a4d7e3"
branch_labels = None
depends_on = None

MV = "mv_household_monthly"

_CREATE = f"""
CREATE MATERIALIZED VIEW {MV} AS
SELECT
    household_id,
    date_trunc('month', txn_date)::date AS period,
    category_id,
    merchant_id,
    currency,
    COALESCE(SUM(COALESCE(base_amount, amount)), 0) AS base_total,
    COALESCE(SUM(
        CASE WHEN COALESCE(base_amount, amount) < 0 OR flags->>'type' = 'income'
             THEN ABS(COALESCE(base_amount, amount)) ELSE 0 END
    ), 0) AS income_total,
    COALESCE(SUM(
        CASE WHEN COALESCE(base_amount, amount) < 0 OR flags->>'type' = 'income'
             THEN 0 ELSE COALESCE(base_amount, amount) END
    ), 0) AS spend_total,
    COUNT(*) AS txn_count
FROM "transaction"
WHERE status = 'confirmed'
GROUP BY household_id, date_trunc('month', txn_date)::date, category_id, merchant_id, currency
WITH DATA
"""


def upgrade() -> None:
    op.execute(_CREATE)
    op.execute(f"CREATE INDEX ix_{MV}_household_period ON {MV} (household_id, period)")


def downgrade() -> None:
    op.execute(f"DROP MATERIALIZED VIEW IF EXISTS {MV}")
