import asyncio, asyncpg, csv, ast, json, os, sys, uuid, datetime, decimal

DSN = os.environ["DATABASE_URL"].replace("postgresql+asyncpg", "postgresql")
DATA = "/tmp/dsload"
HH1 = "532788bd-1641-5dc9-b246-c4397ed4af60"  # primary demo household (USD)

JSONB_COLS = {"flags", "aliases", "penalty_rules", "withholding", "deductions"}

# load order respects FK deps (also session_replication_role=replica disables checks)
TABLES = [
    ("household", "household.csv"),
    ("user", "user.csv"),
    ("account_logical", "account_logical.csv"),
    ("category", "category.csv"),
    ("merchant", "merchant.csv"),
    ("tag", "tag.csv"),
    ("loan", "loan.csv"),
    ("income_source", "income_source.csv"),
    ("transaction", "transaction.csv"),
    ("line_item", "line_item.csv"),
    ("budget", "budget.csv"),
    ("payment_schedule", "payment_schedule.csv"),
    ("paystub", "paystub.csv"),
    ("transaction_tag", "transaction_tag.csv"),
    ("fx_rate", "fx_rate.csv"),
]
# wiped before reload; household/user are preserved (upserted) to keep dev/e2e logins
TRUNCATE = [
    "transaction", "line_item", "transaction_tag", "budget", "loan",
    "payment_schedule", "income_source", "paystub", "merchant",
    "account_logical", "category", "tag", "fx_rate",
]
UPSERT = {"household", "user"}  # ON CONFLICT (id) DO NOTHING


async def coltypes(conn, table):
    rows = await conn.fetch(
        "SELECT column_name, data_type FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name=$1", table)
    return {r["column_name"]: r["data_type"] for r in rows}


def conv(col, val, dt):
    if val == "":
        return None
    if col in JSONB_COLS:
        return json.dumps(ast.literal_eval(val))  # python-literal -> json (text codec)
    if dt == "uuid":
        return uuid.UUID(val)
    if dt == "date":
        return datetime.date.fromisoformat(val)
    if dt == "timestamp with time zone":
        return datetime.datetime.fromisoformat(val)
    if dt == "numeric":
        return decimal.Decimal(val)
    if dt == "double precision":
        return float(val)
    if dt == "integer":
        return int(val)
    if dt == "boolean":
        return val in ("t", "true", "True", "1")
    return val


async def main():
    conn = await asyncpg.connect(DSN)
    await conn.set_type_codec(
        "jsonb", encoder=lambda x: x, decoder=lambda x: x,
        schema="pg_catalog", format="text")
    try:
        async with conn.transaction():
            await conn.execute("SET session_replication_role = replica")
            await conn.execute(f"TRUNCATE {', '.join(TRUNCATE)} CASCADE")
            for table, fname in TABLES:
                types = await coltypes(conn, table)
                with open(os.path.join(DATA, fname), newline="") as f:
                    rdr = csv.reader(f)
                    cols = next(rdr)
                    placeholders = ", ".join(f"${i+1}" for i in range(len(cols)))
                    collist = ", ".join(f'"{c}"' for c in cols)
                    conflict = " ON CONFLICT (id) DO NOTHING" if table in UPSERT else ""
                    sql = f'INSERT INTO "{table}" ({collist}) VALUES ({placeholders}){conflict}'
                    batch = [[conv(cols[i], v, types[cols[i]]) for i, v in enumerate(row)]
                             for row in rdr]
                await conn.executemany(sql, batch)
                print(f"  {table:18} {len(batch):>5} rows")
            await conn.execute("SET session_replication_role = DEFAULT")
        # point the working login at the primary demo household
        res = await conn.execute(
            'UPDATE "user" SET household_id=$1 WHERE email=$2', HH1, "dev@example.com")
        print("repoint dev@example.com ->", HH1, res)
        await conn.execute("REFRESH MATERIALIZED VIEW mv_household_monthly")
        print("matview refreshed")
        n = await conn.fetchval(
            "SELECT count(*) FROM transaction WHERE household_id=$1", HH1)
        print(f"transactions in primary household: {n}")
    finally:
        await conn.close()


asyncio.run(main())
