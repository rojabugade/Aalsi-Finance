#!/usr/bin/env python3
from __future__ import annotations

import ast
import csv
import json
import os
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path


BASE_URL = os.environ.get("SEED_API_URL", "https://codename.kshitij.space/api").rstrip("/")
EMAIL = os.environ.get("SEED_EMAIL", "dev@example.com")
PASSWORD = os.environ.get("SEED_PASSWORD", "hunter2pass")
DATASET_DIR = Path(os.environ.get("SEED_DATASET_DIR", "dataset"))
PRIMARY_HOUSEHOLD_ID = "532788bd-1641-5dc9-b246-c4397ed4af60"

try:
    import certifi

    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except Exception:  # noqa: BLE001
    SSL_CONTEXT = ssl._create_unverified_context() if os.environ.get("SEED_INSECURE_SSL") == "1" else None


def read_csv(name: str) -> list[dict[str, str]]:
    with (DATASET_DIR / name).open(newline="") as f:
        return list(csv.DictReader(f))


def clean(value: str | None):
    return None if value in (None, "") else value


def parse_dict(value: str | None) -> dict:
    if not value:
        return {}
    return ast.literal_eval(value)


def request(method: str, path: str, token: str | None = None, body: dict | list | None = None):
    payload = None if body is None else json.dumps(body)
    headers = ["Content-Type: application/json"]
    if token:
        headers.append(f"Authorization: Bearer {token}")
    cmd = ["curl", "-sS", "-w", "\n%{http_code}", "-X", method]
    for header in headers:
        cmd.extend(["-H", header])
    if payload is not None:
        cmd.extend(["--data", payload])
    cmd.append(f"{BASE_URL}{path}")
    res = subprocess.run(cmd, check=False, text=True, capture_output=True, timeout=45)
    if res.returncode != 0:
        raise RuntimeError(f"{method} {path} curl failed: {res.stderr.strip()}")
    raw, _, code = res.stdout.rpartition("\n")
    status = int(code or "0")
    if status >= 400:
        raise RuntimeError(f"{method} {path} failed: {status} {raw}")
    return json.loads(raw) if raw else None


def login() -> str:
    payload = {"email": EMAIL, "password": PASSWORD, "totp_code": None}
    return request("POST", "/auth/login", body=payload)["access_token"]


def post(token: str, path: str, body: dict | list):
    return request("POST", path, token=token, body=body)


def get(token: str, path: str):
    return request("GET", path, token=token)


def seed_categories(token: str) -> dict[str, str]:
    rows = read_csv("category.csv")
    existing = get(token, "/categories")
    by_key = {(r["name"], r["kind"]): r["id"] for r in existing}
    old_to_new: dict[str, str] = {}

    for row in rows:
        if row["parent_id"]:
            continue
        key = (row["name"], row["kind"])
        if key not in by_key:
            created = post(token, "/categories", {
                "name": row["name"],
                "kind": row["kind"],
                "parent_id": None,
                "is_system": row["is_system"].lower() in {"t", "true", "1"},
            })
            by_key[key] = created["id"]
        old_to_new[row["id"]] = by_key[key]

    for row in rows:
        if not row["parent_id"]:
            continue
        key = (row["name"], row["kind"])
        if key not in by_key:
            created = post(token, "/categories", {
                "name": row["name"],
                "kind": row["kind"],
                "parent_id": old_to_new[row["parent_id"]],
                "is_system": row["is_system"].lower() in {"t", "true", "1"},
            })
            by_key[key] = created["id"]
        old_to_new[row["id"]] = by_key[key]

    print(f"categories mapped: {len(old_to_new)}")
    return old_to_new


def seed_tags(token: str) -> None:
    existing = {r["name"] for r in get(token, "/tags")}
    made = 0
    for row in read_csv("tag.csv"):
        if row["household_id"] != PRIMARY_HOUSEHOLD_ID or row["name"] in existing:
            continue
        post(token, "/tags", {"name": row["name"]})
        existing.add(row["name"])
        made += 1
    print(f"tags created: {made}")


def seed_income(token: str) -> dict[str, str]:
    existing = get(token, "/income-sources")
    by_key = {(r.get("employer"), r.get("frequency"), r.get("currency")): r["id"] for r in existing}
    old_to_new: dict[str, str] = {}
    made = 0
    for row in read_csv("income_source.csv"):
        if row["household_id"] != PRIMARY_HOUSEHOLD_ID:
            continue
        key = (clean(row["employer"]), row["frequency"], row["currency"])
        if key not in by_key:
            created = post(token, "/income-sources", {
                "employer": clean(row["employer"]),
                "country": clean(row["country"]),
                "currency": row["currency"],
                "frequency": row["frequency"],
                "gross": clean(row["gross"]),
                "net": clean(row["net"]),
                "withholding": parse_dict(row["withholding"]),
            })
            by_key[key] = created["id"]
            made += 1
        old_to_new[row["id"]] = by_key[key]

    paystubs = 0
    if made:
        for row in read_csv("paystub.csv"):
            new_source_id = old_to_new.get(row["income_source_id"])
            if not new_source_id:
                continue
            post(token, "/paystubs", {
                "income_source_id": new_source_id,
                "source_document_id": None,
                "period_start": clean(row["period_start"]),
                "period_end": clean(row["period_end"]),
                "gross": clean(row["gross"]),
                "deductions": parse_dict(row["deductions"]),
                "net": clean(row["net"]),
            })
            paystubs += 1
    print(f"income sources created: {made}; paystubs created: {paystubs}")
    return old_to_new


def seed_loans(token: str) -> None:
    existing = {r["name"] for r in get(token, "/loans")}
    made = 0
    for row in read_csv("loan.csv"):
        if row["household_id"] != PRIMARY_HOUSEHOLD_ID or row["name"] in existing:
            continue
        post(token, "/loans", {
            "name": row["name"],
            "type": row["type"],
            "schedule_kind": row["schedule_kind"],
            "principal": row["principal"],
            "currency": row["currency"],
            "interest_rate": clean(row["interest_rate"]),
            "compounding": clean(row["compounding"]),
            "min_or_emi_amount": clean(row["min_or_emi_amount"]),
            "due_day": int(row["due_day"]) if row["due_day"] else None,
            "penalty_rules": parse_dict(row["penalty_rules"]),
            "start_date": clean(row["start_date"]),
            "end_date": clean(row["end_date"]),
        })
        existing.add(row["name"])
        made += 1
    print(f"loans created: {made}")


def seed_budgets(token: str, categories: dict[str, str]) -> None:
    existing = {(r.get("category_id"), r["period"], r["currency"]) for r in get(token, "/budgets")}
    made = 0
    for row in read_csv("budget.csv"):
        if row["household_id"] != PRIMARY_HOUSEHOLD_ID:
            continue
        category_id = categories.get(row["category_id"])
        key = (category_id, row["period"], row["currency"])
        if key in existing:
            continue
        post(token, "/budgets", {
            "category_id": category_id,
            "period": row["period"],
            "amount": row["amount"],
            "currency": row["currency"],
        })
        existing.add(key)
        made += 1
    print(f"budgets created: {made}")


def seed_transactions(token: str, categories: dict[str, str]) -> None:
    line_items = defaultdict(list)
    if (DATASET_DIR / "line_item.csv").exists():
        for row in read_csv("line_item.csv"):
            line_items[row["transaction_id"]].append(row)

    made = 0
    skipped = 0
    for row in read_csv("transaction.csv"):
        if row["household_id"] != PRIMARY_HOUSEHOLD_ID or row["currency"] != "USD":
            skipped += 1
            continue
        items = []
        for item in line_items.get(row["id"], []):
            items.append({
                "name": item["name"],
                "amount": item["amount"],
                "quantity": float(item["quantity"]) if item["quantity"] else None,
                "item_type_category_id": categories.get(item["item_type_category_id"]),
                "confidence": float(item["confidence"]) if item["confidence"] else None,
            })
        merchant = clean(row["notes"])
        body = {
            "merchant": merchant[:120] if merchant else None,
            "amount": row["amount"],
            "currency": row["currency"],
            "txn_date": row["txn_date"],
            "category_id": categories.get(row["category_id"]),
            "status": row["status"],
            "source_channel": "dataset",
            "is_shared": row["is_shared"].lower() in {"t", "true", "1"},
            "flags": parse_dict(row["flags"]),
            "notes": clean(row["notes"]),
            "confidence": float(row["confidence"]) if row["confidence"] else None,
            "external_id": f"dataset:{row['id']}",
            "line_items": items,
        }
        post(token, "/transactions", body)
        made += 1
        if made % 100 == 0:
            print(f"transactions posted: {made}")
            time.sleep(0.2)
    print(f"transactions posted: {made}; skipped: {skipped}")


def main() -> int:
    token = login()
    categories = seed_categories(token)
    seed_tags(token)
    seed_income(token)
    seed_loans(token)
    seed_budgets(token, categories)
    seed_transactions(token, categories)
    txns = get(token, "/transactions")
    print(f"verified transactions visible: {len(txns)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
