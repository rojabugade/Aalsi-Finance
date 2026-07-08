#!/usr/bin/env python3
"""
Plaid sandbox transaction generator + sync trigger for CodeName-Missing.

Daily job flow:
1. Create synthetic transactions in Plaid's Sandbox with /sandbox/transactions/create.
2. Trigger the app's POST /plaid/sync.
3. The app pulls from Plaid via transactions/sync and runs normal enrichment.

Transactions are never posted directly to the app's /transactions endpoint.

Usage:
    python scripts/plaid_sync_trigger.py --env local
    python scripts/plaid_sync_trigger.py --env local --generate-count 5
    python scripts/plaid_sync_trigger.py --env local --no-generate
"""

from __future__ import annotations

import argparse
import json
import os
import random
import subprocess
import sys
from datetime import date
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

API_URL = os.environ.get("GEN_API_URL", "http://localhost:8000").rstrip("/")
EMAIL = os.environ.get("GEN_EMAIL", "dev@example.com")
PASSWORD = os.environ.get("GEN_PASSWORD", "hunter2pass")

ENVIRONMENTS = {
    "local": "http://localhost:8000",
}

PROJECT_ROOT = Path(__file__).resolve().parents[1]
LOCAL_DB_URL = "postgresql+asyncpg://finance:finance@localhost:5433/finance"
PLAID_SANDBOX_CREATE_URL = "https://sandbox.plaid.com/sandbox/transactions/create"
MERCHANTS = [
    ("Hermes Daily Sandbox Coffee", 4.25, 9.75),
    ("Hermes Daily Sandbox Groceries", 28.00, 96.00),
    ("Hermes Daily Sandbox Transit", 2.75, 18.50),
    ("Hermes Daily Sandbox Pharmacy", 8.00, 42.00),
    ("Hermes Daily Sandbox Restaurant", 16.00, 74.00),
    ("Hermes Daily Sandbox Payroll", -2400.00, -900.00),
]


def _login() -> str:
    url = f"{API_URL}/auth/login"
    data = json.dumps({"email": EMAIL, "password": PASSWORD, "totp_code": None}).encode()
    with urlopen(Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST"), timeout=30) as resp:
        return json.loads(resp.read())["access_token"]


def _api(method: str, path: str, token: str, body: dict | None = None, timeout: int = 120) -> dict | None:
    url = f"{API_URL}{path}"
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}
    data = None if body is None else json.dumps(body).encode("utf-8")
    try:
        with urlopen(Request(url, data=data, headers=headers, method=method), timeout=timeout) as resp:
            if resp.status == 204:
                return None
            return json.loads(resp.read())
    except HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="ignore")[:300]
        print(f"  {method} {path} → HTTP {exc.code}: {body_text}", file=sys.stderr)
        return None
    except URLError as exc:
        print(f"  {method} {path} → {exc}", file=sys.stderr)
        return None


def _daily_transactions(count: int) -> list[dict]:
    today = date.today().isoformat()
    rng = random.Random(today)
    picks = [MERCHANTS[i % len(MERCHANTS)] for i in range(count)]
    transactions = []
    for index, (merchant, low, high) in enumerate(picks, start=1):
        amount = round(rng.uniform(low, high), 2)
        transactions.append({
            "date_transacted": today,
            "date_posted": today,
            "amount": amount,
            "description": f"{merchant} {today} #{index}",
            "iso_currency_code": "USD",
        })
    return transactions


def _docker_generation_helper(transactions: list[dict]) -> str:
    payload = json.dumps(transactions[:10])
    return f'''
import asyncio, json, urllib.request, sys
from sqlalchemy import select
from app.config import get_settings
from app.db import SessionLocal
from app.ingestion.crypto import decrypt_string
from app.models.accounts import PlaidItem

PLAID_SANDBOX_CREATE_URL = {PLAID_SANDBOX_CREATE_URL!r}
TRANSACTIONS = json.loads({payload!r})

async def active_tokens():
    async with SessionLocal() as session:
        rows = (await session.execute(select(PlaidItem).where(PlaidItem.status == "active"))).scalars().all()
        return [token for item in rows if (token := decrypt_string(item.access_token_encrypted))]

def create_for_token(settings, access_token):
    body = {{
        "client_id": settings.plaid_client_id,
        "secret": settings.plaid_secret,
        "access_token": access_token,
        "transactions": TRANSACTIONS,
    }}
    req = urllib.request.Request(
        PLAID_SANDBOX_CREATE_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={{"Content-Type": "application/json"}},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp.read()
        return resp.status == 200

async def main():
    settings = get_settings()
    created = 0
    for token in await active_tokens():
        try:
            if create_for_token(settings, token):
                created += len(TRANSACTIONS)
        except Exception as exc:
            print(f"Plaid sandbox transaction create failed: {{exc}}", file=sys.stderr)
    print(created)

asyncio.run(main())
'''


def generate_plaid_sandbox_transactions(count: int) -> int:
    transactions = _daily_transactions(count)
    command = ["docker", "compose", "-f", "docker-compose.dev.yml", "exec", "-T", "api", "python", "-"]
    result = subprocess.run(
        command,
        input=_docker_generation_helper(transactions),
        text=True,
        capture_output=True,
        cwd=PROJECT_ROOT,
        timeout=120,
        check=False,
    )
    if result.stderr.strip():
        print(result.stderr.strip(), file=sys.stderr)
    if result.returncode != 0:
        print(result.stdout.strip(), file=sys.stderr)
        raise RuntimeError("Plaid sandbox transaction generation failed inside the API container")
    return int(result.stdout.strip().splitlines()[-1] or "0")


def run(env: str = "local", generate: bool = True, generate_count: int = 3) -> int:
    global API_URL
    if env in ENVIRONMENTS:
        API_URL = ENVIRONMENTS[env]
    elif env:
        raise ValueError(f"Unsupported environment: {env}. This trigger is local-only.")

    if generate:
        print("🏦 Creating synthetic transactions in Plaid Sandbox ...")
        generated = generate_plaid_sandbox_transactions(generate_count)
        print(f"✅ Submitted {generated} sandbox transactions to Plaid")

    print(f"🔐 {API_URL}")
    token = _login()
    print("✅ Authenticated")

    print("🔄 POST /plaid/sync ...")
    result = _api("POST", "/plaid/sync", token, {}) or {}

    created = result.get("transactions_created", 0)
    updated = result.get("transactions_updated", 0)
    removed = result.get("transactions_removed", 0)
    loans = result.get("loans_synced", 0)
    payments = result.get("payments_registered", 0)
    refunds = result.get("refunds_linked", 0)
    balances = result.get("balances_written", 0)

    print(f"""
📊 Sync complete:
   Transactions: +{created} new, ~{updated} updated, -{removed} removed
   Loans synced: {loans}
   Payments registered: {payments}
   Refunds linked: {refunds}
   Balances written: {balances}
""")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate Plaid sandbox transactions, then trigger app sync")
    parser.add_argument("--env", type=str, default="local")
    parser.add_argument("--generate-count", type=int, default=3)
    parser.add_argument("--no-generate", action="store_true")
    args = parser.parse_args()
    sys.exit(run(env=args.env, generate=not args.no_generate, generate_count=args.generate_count))
