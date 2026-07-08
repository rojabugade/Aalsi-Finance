-- Seed deterministic monthly balance snapshots for every logical account so net
-- worth (and its trend) is real for the demo households. Idempotent: re-running
-- only fills missing (account_id, as_of) rows.
--
-- Per account a stable fraction is derived from md5(id); balances scale by account
-- type. Assets grow gently over time (older months lower); liabilities ease down.
-- A small per-month noise term keeps the trend line from looking synthetic-flat.
--
-- Apply:  docker exec -i codename-missing-postgres-1 psql -U finance -d finance < scripts/seed_account_balances.sql

INSERT INTO account_balance (household_id, account_id, as_of, balance)
SELECT
    a.household_id,
    a.id,
    (date_trunc('month', CURRENT_DATE) - (gs || ' months')::interval)::date AS as_of,
    ROUND(
        (CASE a.type
            WHEN 'checking'   THEN 2000  + f.frac * 6000
            WHEN 'savings'    THEN 8000  + f.frac * 32000
            WHEN 'investment' THEN 15000 + f.frac * 105000
            WHEN 'cash'       THEN 100   + f.frac * 900
            WHEN 'credit'     THEN 300   + f.frac * 3700
            WHEN 'loan'       THEN 5000  + f.frac * 45000
            ELSE 1000
        END)
        * (CASE
            WHEN a.type IN ('credit', 'loan') THEN (0.88 + 0.03 * gs)   -- liabilities: higher in older months
            ELSE (1.0 - 0.012 * gs)                                     -- assets: lower in older months (growth)
          END)
        * (1 + 0.02 * (n.noise - 0.5)),                                 -- +/-1% per-month wobble
        2
    )::numeric(18, 2) AS balance
FROM account_logical a
CROSS JOIN generate_series(0, 5) AS gs
CROSS JOIN LATERAL (
    SELECT (('x' || substr(md5(a.id::text), 1, 8))::bit(32)::bigint & 2147483647)::numeric / 2147483647.0 AS frac
) f
CROSS JOIN LATERAL (
    SELECT (('x' || substr(md5(a.id::text || gs::text), 1, 8))::bit(32)::bigint & 2147483647)::numeric / 2147483647.0 AS noise
) n
ON CONFLICT (account_id, as_of) DO NOTHING;
