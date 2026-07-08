#!/usr/bin/env python3
"""Generate ~1 year of realistic financial data matching the app's DB schema.

Output: CSV files per table under /tmp/finance_dataset/ (or DATA_DIR env).
"""

import csv
import hashlib
import io
import itertools
import math
import os
import random
import uuid
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional

# ── Config ──────────────────────────────────────────────────────────────────
SEED = 42
random.seed(SEED)

DATA_DIR = os.environ.get("DATA_DIR", "/tmp/finance_dataset")
os.makedirs(DATA_DIR, exist_ok=True)

START_DATE = date(2025, 7, 1)
END_DATE = date(2026, 6, 30)  # ~1 year

NUM_HOUSEHOLDS = 2
USERS_PER_HOUSEHOLD = [2, 3]   # 2 in HH-1, 3 in HH-2
INCOME_TYPES = ["Salary", "Freelance", "Mixed"]
CURRENCIES = ["USD", "EUR", "INR", "GBP"]
BASE_CURRENCY = "USD"

# Income profiles (monthly net in USD)
INCOME_PROFILES = [
    {"type": "Salary", "employer": "Acme Corp", "gross": 96000, "net": 72000, "currency": "USD", "country": "US", "freq": "semimonthly"},
    {"type": "Salary", "employer": "TechGlobal Inc", "gross": 132000, "net": 96000, "currency": "USD", "country": "US", "freq": "semimonthly"},
    {"type": "Freelance", "employer": None, "gross": 48000, "net": 36000, "currency": "USD", "country": "US", "freq": "monthly"},
    {"type": "Salary", "employer": "EduSkills Ltd", "gross": 54000, "net": 42000, "currency": "GBP", "country": "GB", "freq": "monthly"},
]

# Spending patterns by category (% of monthly expense)
SPEND_PATTERNS = {
    "Housing": 0.30,
    "Groceries": 0.12,
    "Food & Dining": 0.08,
    "Transportation": 0.10,
    "Utilities": 0.06,
    "Shopping": 0.08,
    "Entertainment": 0.05,
    "Health & Medical": 0.04,
    "Personal Care": 0.03,
    "Education": 0.02,
    "Gifts & Donations": 0.02,
    "Travel": 0.05,
    "Miscellaneous": 0.05,
}

# Sub-category distribution within each parent
SUBCAT_WEIGHTS = {
    "Housing": {"Rent": 0.7, "Mortgage": 0.0, "Property Tax": 0.15, "Home Maintenance": 0.15},
    "Food & Dining": {"Restaurants": 0.4, "Coffee Shops": 0.2, "Fast Food": 0.25, "Alcohol & Bars": 0.15},
    "Transportation": {"Fuel": 0.35, "Public Transit": 0.2, "Rideshare": 0.15, "Parking": 0.1, "Auto Maintenance": 0.2},
    "Utilities": {"Electricity": 0.35, "Water": 0.15, "Gas": 0.15, "Internet": 0.2, "Mobile Phone": 0.15},
    "Shopping": {"Clothing": 0.25, "Electronics": 0.3, "Home & Furniture": 0.25, "Hobbies": 0.2},
    "Entertainment": {"Streaming": 0.3, "Movies & Events": 0.25, "Games": 0.2, "Subscriptions": 0.25},
    "Health & Medical": {"Doctor": 0.3, "Pharmacy": 0.25, "Dental": 0.2, "Insurance Premiums": 0.25},
    "Personal Care": {"Salon & Spa": 0.35, "Gym & Fitness": 0.35, "Cosmetics": 0.3},
    "Education": {"Tuition": 0.4, "Books & Supplies": 0.3, "Courses": 0.3},
    "Travel": {"Flights": 0.4, "Hotels": 0.35, "Car Rental": 0.25},
    "Financial": {"Bank Fees": 0.1, "Interest Charges": 0.2, "Investments": 0.5, "Taxes": 0.2},
}

# Merchant→category mapping for realistic description generation
MERCHANT_CATEGORY = {
    "Amazon": "Shopping", "Walmart": "Groceries", "Target": "Shopping",
    "Costco": "Groceries", "Macy's": "Shopping", "Starbucks": "Food & Dining",
    "McDonald's": "Food & Dining", "Uber": "Transportation", "Lyft": "Transportation",
    "Netflix": "Entertainment", "Spotify": "Entertainment", "Apple": "Shopping",
    "Google": "Entertainment", "Shell": "Transportation", "Whole Foods": "Groceries",
    "Trader Joe's": "Groceries", "CVS Pharmacy": "Health & Medical",
    "Walgreens": "Health & Medical", "Home Depot": "Housing",
    "Best Buy": "Shopping", "Kroger": "Groceries", "Safeway": "Groceries",
    "Dunkin'": "Food & Dining", "Chipotle": "Food & Dining", "Subway": "Food & Dining",
    "Panera Bread": "Food & Dining", "7-Eleven": "Groceries", "Duane Reade": "Health & Medical",
    "ExxonMobil": "Transportation", "BP": "Transportation", "Chevron": "Transportation",
    "Verizon": "Utilities", "AT&T": "Utilities", "T-Mobile": "Utilities",
    "Comcast": "Utilities", "Con Edison": "Utilities", "National Grid": "Utilities",
    "Delta Air Lines": "Travel", "United Airlines": "Travel", "American Airlines": "Travel",
    "Marriott": "Travel", "Hilton": "Travel", "Airbnb": "Travel",
    "Planet Fitness": "Personal Care", "24 Hour Fitness": "Personal Care",
    "Walgreens Beauty": "Personal Care", "Sephora": "Personal Care",
    "MTA": "Transportation", "NYC Transit": "Transportation", "ParkMobile": "Transportation",
    "Hulu": "Entertainment", "Disney+": "Entertainment", "HBO Max": "Entertainment",
    "Adobe": "Entertainment", "Microsoft": "Entertainment",
}

MERCHANT_ALIASES = {
    "Amazon": ["amazon.com", "amzn", "amazon mktp", "AMZN MKTP"],
    "Walmart": ["wal-mart", "walmart.com", "WAL-MART"],
    "Target": ["target.com", "TARGET"],
    "Costco": ["costco whse", "COSTCO"],
    "Starbucks": ["sbux", "STARBUCKS"],
    "Uber": ["uber trip", "uber eats", "UBER *TRIP"],
    "Netflix": ["netflix.com", "NFLX"],
    "Spotify": ["spotify", "SPOTIFY"],
    "Apple": ["apple.com/bill", "itunes", "APPLE STORE"],
    "Google": ["google *", "google services", "GOOGLE PLAY"],
    "Shell": ["shell oil", "SHELL"],
    "Whole Foods": ["whole foods market", "wfm", "WHOLE FOODS"],
    "Verizon": ["verizon wireless", "VZ"],
    "Comcast": ["xfinity", "COMCAST"],
    "Delta Air Lines": ["delta", "DELTA"],
    "Marriott": ["marriott hotels", "MARRIOTT"],
    "Hilton": ["hilton hotels", "HILTON"],
}

FX_PAIRS = ["USD/EUR", "USD/GBP", "USD/INR", "EUR/GBP", "EUR/INR", "GBP/INR"]
FX_BASE_RATES = {
    "USD/EUR": 0.85, "USD/GBP": 0.75, "USD/INR": 83.0,
    "EUR/GBP": 0.88, "EUR/INR": 97.5, "GBP/INR": 110.5,
}
FX_VOLATILITY = 0.05  # ±5% over the year

# ── Helpers ─────────────────────────────────────────────────────────────────

_NS = uuid.UUID("00000000-0000-0000-0000-0000000c0de5")

def stable_uuid(name: str) -> uuid.UUID:
    return uuid.uuid5(_NS, name)

def rand_amount(min_v: float, max_v: float, decimals: int = 2) -> Decimal:
    return round(Decimal(random.uniform(min_v, max_v)), decimals)

def rand_int(min_v: int, max_v: int) -> int:
    return random.randint(min_v, max_v)

def pick_weighted(options: dict) -> str:
    items, weights = zip(*options.items())
    return random.choices(items, weights=weights, k=1)[0]

def daterange(d1: date, d2: date) -> list[date]:
    days = [(d1 + timedelta(days=i)) for i in range((d2 - d1).days + 1)]
    return days

# ── Data holders ────────────────────────────────────────────────────────────

rows: dict[str, list[dict]] = {
    "household": [],
    "user": [],
    "account_logical": [],
    "category": [],
    "merchant": [],
    "tag": [],
    "income_source": [],
    "paystub": [],
    "loan": [],
    "payment_schedule": [],
    "budget": [],
    "transaction": [],
    "line_item": [],
    "fx_rate": [],
    "transaction_tag": [],
}

# ── 1. Categories (system taxonomy from M1 migration) ──────────────────────
TAXONOMY: dict[str, list[str]] = {
    "Income": ["Salary", "Bonus", "Interest", "Dividends", "Refunds"],
    "Food & Dining": ["Restaurants", "Coffee Shops", "Fast Food", "Alcohol & Bars"],
    "Groceries": [],
    "Shopping": ["Clothing", "Electronics", "Home & Furniture", "Hobbies"],
    "Transportation": ["Fuel", "Public Transit", "Rideshare", "Parking", "Auto Maintenance"],
    "Housing": ["Rent", "Mortgage", "Property Tax", "Home Maintenance"],
    "Utilities": ["Electricity", "Water", "Gas", "Internet", "Mobile Phone"],
    "Health & Medical": ["Doctor", "Pharmacy", "Dental", "Insurance Premiums"],
    "Entertainment": ["Streaming", "Movies & Events", "Games", "Subscriptions"],
    "Travel": ["Flights", "Hotels", "Car Rental"],
    "Education": ["Tuition", "Books & Supplies", "Courses"],
    "Personal Care": ["Salon & Spa", "Gym & Fitness", "Cosmetics"],
    "Financial": ["Bank Fees", "Interest Charges", "Investments", "Taxes"],
    "Transfers": ["Cross-Border Transfer", "Internal Transfer", "Credit Card Payment"],
    "Gifts & Donations": [],
    "Business": ["Office Supplies", "Software", "Travel & Meals"],
    "Miscellaneous": [],
}

ITEM_TYPES = [
    "Apparel", "Cosmetics", "Electronics Item", "Grocery Item",
    "Household Item", "Toy", "Book", "Food Item", "Beverage",
]

PRODUCT_CATALOG: dict[str, list[tuple[str, str]]] = {
    "Amazon": [
        ("Anker 20W USB-C fast charger, white", "Electronics Item"),
        ("Amazon Basics braided HDMI cable, 6 ft", "Electronics Item"),
        ("Kindle ebook: personal finance workbook", "Book"),
        ("Ninja replacement blender cups, 2-pack", "Household Item"),
        ("Sony WH-CH520 wireless headphones, black", "Electronics Item"),
        ("Command picture hanging strips, medium", "Household Item"),
    ],
    "Walmart": [
        ("Great Value cage-free large eggs, 18 count", "Grocery Item"),
        ("Equate daily multivitamin tablets, 200 count", "Household Item"),
        ("Fresh bananas, per lb", "Grocery Item"),
        ("Tide hygienic clean detergent, 92 fl oz", "Household Item"),
        ("Mainstays bath towel, charcoal", "Household Item"),
        ("Marketside rotisserie chicken, hot", "Food Item"),
    ],
    "Target": [
        ("Good & Gather organic whole milk, 1 gal", "Grocery Item"),
        ("Cat & Jack kids graphic t-shirt", "Apparel"),
        ("Up & Up paper towels, 6 double rolls", "Household Item"),
        ("Threshold cotton sheet set, queen", "Household Item"),
        ("Olay Regenerist face moisturizer, 1.7 oz", "Cosmetics"),
        ("LEGO Speed Champions car set", "Toy"),
    ],
    "Costco": [
        ("Kirkland Signature paper towels, 12 rolls", "Household Item"),
        ("Kirkland organic chicken breast, family pack", "Grocery Item"),
        ("Kirkland Colombian coffee beans, 3 lb", "Beverage"),
        ("Duracell AA batteries, 40 pack", "Electronics Item"),
        ("Tillamook cheddar cheese block, 2.5 lb", "Grocery Item"),
        ("Kirkland sparkling water variety pack, 35 ct", "Beverage"),
    ],
    "Macy's": [
        ("Charter Club wrinkle-resistant dress shirt", "Apparel"),
        ("Calvin Klein slim-fit chinos", "Apparel"),
        ("Clinique moisture surge gel cream", "Cosmetics"),
        ("Hotel Collection bath robe", "Apparel"),
    ],
    "Whole Foods": [
        ("365 organic baby spinach, 5 oz", "Grocery Item"),
        ("Atlantic salmon fillet, per lb", "Grocery Item"),
        ("Sourdough boule, bakery fresh", "Food Item"),
        ("Oatly oat milk, original, 64 fl oz", "Beverage"),
        ("Organic strawberries, 1 lb", "Grocery Item"),
    ],
    "Trader Joe's": [
        ("Mandarin orange chicken, frozen", "Food Item"),
        ("Everything but the Bagel seasoning", "Grocery Item"),
        ("Unexpected cheddar cheese, 7 oz", "Grocery Item"),
        ("Cold brew coffee concentrate", "Beverage"),
        ("Organic jasmine rice, 3 lb", "Grocery Item"),
    ],
    "Kroger": [
        ("Private Selection sourdough bread", "Food Item"),
        ("Simple Truth organic Greek yogurt, 32 oz", "Grocery Item"),
        ("Kroger gala apples, 3 lb bag", "Grocery Item"),
        ("Kroger purified water, 24 pack", "Beverage"),
        ("Home Chef ready-to-cook salmon meal", "Food Item"),
    ],
    "CVS Pharmacy": [
        ("CVS Health ibuprofen 200mg caplets, 100 ct", "Household Item"),
        ("Colgate Optic White toothpaste, 4.2 oz", "Household Item"),
        ("Neutrogena Ultra Sheer sunscreen SPF 55", "Cosmetics"),
        ("Band-Aid flexible fabric bandages, 30 ct", "Household Item"),
    ],
    "Best Buy": [
        ("Logitech MX Master 3S wireless mouse", "Electronics Item"),
        ("SanDisk Extreme portable SSD, 1TB", "Electronics Item"),
        ("Insignia 6-outlet surge protector", "Electronics Item"),
        ("Apple AirTag, single pack", "Electronics Item"),
    ],
    "Home Depot": [
        ("Behr Premium Plus interior paint, 1 gal", "Household Item"),
        ("Husky heavy-duty storage bin, 27 gal", "Household Item"),
        ("Ryobi drill bit set, 20 piece", "Household Item"),
        ("Miracle-Gro potting mix, 25 qt", "Household Item"),
    ],
    "Starbucks": [
        ("Grande oat milk latte", "Beverage"),
        ("Spinach feta breakfast wrap", "Food Item"),
        ("Iced brown sugar shaken espresso", "Beverage"),
    ],
    "Chipotle": [
        ("Chicken burrito bowl with guacamole", "Food Item"),
        ("Steak tacos, three count", "Food Item"),
        ("Chips and tomatillo salsa", "Food Item"),
    ],
    "Dunkin'": [
        ("Medium iced coffee with oat milk", "Beverage"),
        ("Bacon egg and cheese croissant", "Food Item"),
        ("Half dozen assorted donuts", "Food Item"),
    ],
    "McDonald's": [
        ("Quarter Pounder meal", "Food Item"),
        ("McCafe medium latte", "Beverage"),
        ("10 piece Chicken McNuggets", "Food Item"),
    ],
    "Shell": [
        ("Regular unleaded fuel, pump 4", "Household Item"),
        ("Car wash express package", "Household Item"),
        ("Bottled water and road snack", "Food Item"),
    ],
}

category_map: dict[str, uuid.UUID] = {}  # name → id

def _cat_id(name: str) -> uuid.UUID:
    return stable_uuid(f"category:{name}")

for top, subs in TAXONOMY.items():
    tid = _cat_id(top)
    category_map[top] = tid
    rows["category"].append({
        "id": str(tid), "household_id": "", "parent_id": "",
        "name": top, "kind": "category", "is_system": "t",
    })
    for sub in subs:
        sid = _cat_id(f"{top}/{sub}")
        category_map[sub] = sid
        rows["category"].append({
            "id": str(sid), "household_id": "", "parent_id": str(tid),
            "name": sub, "kind": "subcategory", "is_system": "t",
        })

for it in ITEM_TYPES:
    iid = _cat_id(f"item_type/{it}")
    category_map[it] = iid
    rows["category"].append({
        "id": str(iid), "household_id": "", "parent_id": "",
        "name": it, "kind": "item_type", "is_system": "t",
    })

# ── 2. Merchants ────────────────────────────────────────────────────────────
MERCHANTS = [
    ("Amazon", ["amazon.com", "amzn", "amazon mktp"], "Shopping"),
    ("Walmart", ["wal-mart", "walmart.com"], "Groceries"),
    ("Target", ["target.com"], "Shopping"),
    ("Costco", ["costco whse"], "Groceries"),
    ("Macy's", ["macys", "macy s"], "Shopping"),
    ("Starbucks", ["sbux"], "Food & Dining"),
    ("McDonald's", ["mcdonalds"], "Food & Dining"),
    ("Uber", ["uber trip", "uber eats"], "Transportation"),
    ("Lyft", [], "Transportation"),
    ("Netflix", ["netflix.com"], "Entertainment"),
    ("Spotify", ["spotify"], "Entertainment"),
    ("Apple", ["apple.com/bill", "itunes"], "Shopping"),
    ("Google", ["google *", "google services"], "Entertainment"),
    ("Shell", ["shell oil"], "Transportation"),
    ("Whole Foods", ["whole foods market", "wfm"], "Groceries"),
    ("Trader Joe's", [], "Groceries"),
    ("CVS Pharmacy", [], "Health & Medical"),
    ("Best Buy", [], "Shopping"),
    ("Kroger", [], "Groceries"),
    ("Chipotle", [], "Food & Dining"),
    ("Verizon", ["verizon wireless"], "Utilities"),
    ("Comcast", ["xfinity"], "Utilities"),
    ("Delta Air Lines", ["delta"], "Travel"),
    ("Marriott", ["marriott hotels"], "Travel"),
    ("Hilton", ["hilton hotels"], "Travel"),
    ("Planet Fitness", [], "Personal Care"),
    ("Home Depot", [], "Housing"),
    ("Dunkin'", [], "Food & Dining"),
]

merchant_map: dict[str, uuid.UUID] = {}
for name, aliases, cat in MERCHANTS:
    mid = stable_uuid(f"merchant:{name}")
    merchant_map[name] = mid
    rows["merchant"].append({
        "id": str(mid), "household_id": "",
        "canonical_name": name,
        "aliases": str(aliases),
        "default_category_id": str(category_map[cat]),
    })

# ── 3. Households + Users + Accounts + Tags ─────────────────────────────────

household_ids: list[uuid.UUID] = []
user_map: dict[int, dict] = {}  # idx → user info

for hh_idx in range(NUM_HOUSEHOLDS):
    hh_id = stable_uuid(f"household:{hh_idx}")
    household_ids.append(hh_id)
    rows["household"].append({
        "id": str(hh_id),
        "name": f"Household {hh_idx + 1}",
        "base_currency": BASE_CURRENCY,
        "created_at": datetime(2025, 1, 1, 0, 0, 0).isoformat(),
    })

    num_users = USERS_PER_HOUSEHOLD[hh_idx]
    for u_idx in range(num_users):
        uid = stable_uuid(f"user:{hh_idx}:{u_idx}")
        role = "owner" if u_idx == 0 else random.choice(["member", "member", "viewer"])
        display_name = f"Person {hh_idx+1}-{u_idx+1}"
        email = f"p{hh_idx+1}_{u_idx+1}@example.com"
        income_profile = INCOME_PROFILES[hh_idx * 2 + u_idx] if u_idx < 2 else INCOME_PROFILES[-1]

        user_map[f"{hh_idx}:{u_idx}"] = {
            "id": uid, "hh_id": hh_id, "display_name": display_name,
            "email": email, "role": role, "income": income_profile,
        }
        rows["user"].append({
            "id": str(uid), "household_id": str(hh_id),
            "email": email, "password_hash": "<placeholder>",
            "display_name": display_name, "locale": "en-US",
            "role": role, "mfa_secret": "", "created_at": datetime(2025, 1, 1, 0, 0, 0).isoformat(),
        })

        # Accounts per user
        account_types = ["checking", "savings", "credit"]
        if u_idx == 0:
            account_types += ["investment"]
        for acct_type in account_types:
            aid = stable_uuid(f"account:{hh_idx}:{u_idx}:{acct_type}")
            currency = BASE_CURRENCY
            if acct_type == "investment":
                currency = random.choice(["USD", "USD", "USD", "EUR"])
            rows["account_logical"].append({
                "id": str(aid), "household_id": str(hh_id),
                "owner_user_id": str(uid), "label": f"{display_name}'s {acct_type.title()}",
                "type": acct_type, "currency": currency,
                "is_shared": "f" if acct_type != "savings" else "t",
                "mask": f"xxxx{rand_int(1000,9999)}", "plaid_item_id": "", "plaid_account_id": "",
            })

    # Household tags
    for tag_name in ["recurring", "business", "reimbursable", "tax-deductible", "annual"]:
        rows["tag"].append({
            "id": str(stable_uuid(f"tag:{hh_idx}:{tag_name}")),
            "household_id": str(hh_id), "name": tag_name,
        })

# ── 4. Income sources + paystubs ────────────────────────────────────────────

income_source_map: dict[str, uuid.UUID] = {}  # user_key:source_type → id

for uk, uinfo in user_map.items():
    inc = uinfo["income"]
    is_id = stable_uuid(f"income:{uk}")
    income_source_map[f"{uk}:main"] = is_id
    freq = inc["freq"]
    monthly_net = Decimal(str(inc["net"])) / 12
    monthly_gross = Decimal(str(inc["gross"])) / 12
    if freq == "semimonthly":
        pay_net = monthly_net / 2
        pay_gross = monthly_gross / 2
    else:
        pay_net = monthly_net
        pay_gross = monthly_gross

    rows["income_source"].append({
        "id": str(is_id), "household_id": str(uinfo["hh_id"]),
        "owner_user_id": str(uinfo["id"]),
        "employer": inc["employer"] or uinfo["display_name"],
        "country": inc["country"], "currency": inc["currency"],
        "frequency": freq, "gross": str(pay_gross), "net": str(pay_net),
        "withholding": str({"federal": 0.15, "state": 0.05, "social_security": 0.062}),
    })

    # Generate paystubs across the year
    cur = START_DATE.replace(day=1)
    while cur <= END_DATE:
        if freq == "semimonthly":
            pay_dates = [cur, cur.replace(day=15)]
        else:
            pay_dates = [cur]
        for pd in pay_dates:
            if pd < START_DATE or pd > END_DATE:
                continue
            ps_id = stable_uuid(f"paystub:{uk}:{pd.isoformat()}")
            period_start = pd
            period_end = pd + timedelta(days=14) if freq == "semimonthly" else pd + timedelta(days=30)
            gross_var = pay_gross * Decimal(str(random.uniform(0.95, 1.05)))
            net_var = pay_net * Decimal(str(random.uniform(0.95, 1.05)))
            rows["paystub"].append({
                "id": str(ps_id), "income_source_id": str(is_id),
                "source_document_id": "",
                "period_start": period_start.isoformat(),
                "period_end": min(period_end, END_DATE).isoformat(),
                "gross": str(gross_var.quantize(Decimal("0.01"))),
                "deductions": str({"federal": "0.15", "state": "0.05", "medicare": "0.0145"}),
                "net": str(net_var.quantize(Decimal("0.01"))),
            })
        # advance
        if freq == "monthly":
            cur = (cur.replace(day=28) + timedelta(days=4)).replace(day=1)
        else:
            cur = (cur.replace(day=28) + timedelta(days=4)).replace(day=1)

# ── 5. Loans ────────────────────────────────────────────────────────────────

loan_ids: list[uuid.UUID] = []
# HH-0 gets a mortgage, HH-1 gets an auto loan
loan_configs = [
    {"hh_idx": 0, "type": "home", "schedule_kind": "amortizing", "principal": 450000,
     "interest_rate": "6.5", "min_or_emi": 2840.00, "due_day": 1, "start": date(2024, 6, 1)},
    {"hh_idx": 1, "type": "auto", "schedule_kind": "amortizing", "principal": 35000,
     "interest_rate": "4.2", "min_or_emi": 645.00, "due_day": 15, "start": date(2025, 3, 1)},
]

for lc in loan_configs:
    hh_id = household_ids[lc["hh_idx"]]
    owner_key = f"{lc['hh_idx']}:0"
    uid = user_map[owner_key]["id"]
    lid = stable_uuid(f"loan:{lc['hh_idx']}:{lc['type']}")
    loan_ids.append(lid)
    rows["loan"].append({
        "id": str(lid), "household_id": str(hh_id),
        "owner_user_id": str(uid), "name": f"{lc['type'].title()} Loan",
        "type": lc["type"], "schedule_kind": lc["schedule_kind"],
        "principal": str(lc["principal"]), "currency": BASE_CURRENCY,
        "interest_rate": lc["interest_rate"], "compounding": "monthly",
        "min_or_emi_amount": str(lc["min_or_emi"]),
        "due_day": str(lc["due_day"]), "penalty_rules": str({"late_fee_pct": "0.05"}),
        "start_date": lc["start"].isoformat(),
        "end_date": date(lc["start"].year + 15, lc["start"].month, 1).isoformat() if lc["type"] == "home"
                    else date(lc["start"].year + 5, lc["start"].month, 1).isoformat(),
    })

    # Generate payment schedule for months within our date range
    p_balance = Decimal(str(lc["principal"]))
    annual_rate = Decimal(lc["interest_rate"]) / 100
    monthly_rate = annual_rate / 12
    emi = Decimal(str(lc["min_or_emi"]))
    inst_no = 1
    pmt_date = max(lc["start"] + timedelta(days=lc["due_day"] - 1), START_DATE)
    while pmt_date <= END_DATE and p_balance > 0:
        interest_part = (p_balance * monthly_rate).quantize(Decimal("0.01"))
        principal_part = min(emi - interest_part, p_balance)
        p_balance = max(p_balance - principal_part, Decimal("0"))
        ps_id = stable_uuid(f"payment:{lc['hh_idx']}:{lc['type']}:{inst_no}")
        rows["payment_schedule"].append({
            "id": str(ps_id), "loan_id": str(lid),
            "installment_no": inst_no,
            "due_date": pmt_date.isoformat(),
            "principal_component": str(principal_part),
            "interest_component": str(interest_part),
            "balance_after": str(p_balance.quantize(Decimal("0.01"))),
            "status": "paid" if pmt_date < date.today() else "due",
        })
        inst_no += 1
        # next month
        pmt_date = (pmt_date.replace(day=28) + timedelta(days=4)).replace(day=lc["due_day"])

# ── 6. Budgets ──────────────────────────────────────────────────────────────

for hh_idx, hh_id in enumerate(household_ids):
    for cat_name, pct in SPEND_PATTERNS.items():
        cat_uuid = category_map.get(cat_name)
        if not cat_uuid:
            continue
        annual_income = sum(
            Decimal(str(u["income"]["net"])) for uk, u in user_map.items()
            if str(u["hh_id"]) == str(hh_id)
        ) / 12  # monthly net household income
        monthly_budget = (annual_income * Decimal(str(pct))).quantize(Decimal("0.01"))
        bid = stable_uuid(f"budget:{hh_idx}:{cat_name}")
        rows["budget"].append({
            "id": str(bid), "household_id": str(hh_id),
            "category_id": str(cat_uuid),
            "period": "monthly", "amount": str(monthly_budget),
            "currency": BASE_CURRENCY,
        })

# ── 7. Transactions (the big one) ───────────────────────────────────────────

# Build account map: user_key → [(account_id, type, currency)]
acct_map: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
for r in rows["account_logical"]:
    # Find user by matching account id pattern
    for uk, uinfo in user_map.items():
        if str(uinfo["id"]) == r.get("owner_user_id", ""):
            acct_map[uk].append((r["id"], r["type"], r["currency"]))

def merchant_category(merchant_name: str) -> Optional[str]:
    for m_name, aliases, cat in MERCHANTS:
        if m_name == merchant_name:
            return cat
    return None

def gen_transaction_description(merchant_name: str) -> str:
    """Generate realistic transaction descriptions."""
    desc_templates = {
        "Amazon": ["AMZN MKTP US*{}", "Amazon.com {} {}"],
        "Walmart": ["WAL-MART #{}", "WALMART {} {}"],
        "Target": ["TARGET {} {}"],
        "Costco": ["COSTCO WHSE #{}"],
        "Starbucks": ["STARBUCKS {} {}"],
        "Uber": ["UBER *TRIP {}"],
        "Shell": ["SHELL OIL {} {}"],
        "Netflix": ["NETFLIX.COM"],
        "Spotify": ["SPOTIFY USA"],
        "Verizon": ["VERIZON WIRELESS {}"],
        "Comcast": ["COMCAST {}"],
        "Whole Foods": ["WHOLE FOODS {} {}"],
        "Delta Air Lines": ["DELTA AIR LINES {}"],
        "Apple": ["APPLE.COM/BILL"],
        "Google": ["GOOGLE *YOUTUBE PREMIUM"],
        "CVS Pharmacy": ["CVS PHARMACY #{}"],
        "Home Depot": ["HOME DEPOT #{} {}"],
        "McDonald's": ["MCDONALD'S #{}"],
        "Chipotle": ["CHIPOTLE {} {}"],
        "Kroger": ["KROGER #{}"],
        "Trader Joe's": ["TRADER JOE'S #{}"],
    }
    templates = desc_templates.get(merchant_name, [merchant_name.upper()])
    tpl = random.choice(templates)
    if "{}" in tpl:
        fillers = [str(rand_int(1000, 9999)), random.choice(["DEBIT", "PURCHASE", "PAYMENT", ""])]
        # Count how many placeholders and fill
        count = tpl.count("{}")
        args = tuple(fillers[:count])
        return tpl.format(*args)
    return tpl

def gen_merchant_txn_date(d: date, merchant: str) -> Optional[Decimal]:
    """Generate a plausible transaction amount for a merchant."""
    ranges = {
        "Amazon": (5, 200), "Walmart": (10, 150), "Target": (10, 120),
        "Costco": (30, 300), "Macy's": (20, 250), "Starbucks": (3, 15),
        "McDonald's": (5, 15), "Uber": (8, 40), "Lyft": (8, 35),
        "Netflix": (15.49, 15.49), "Spotify": (9.99, 9.99),
        "Apple": (0.99, 30), "Google": (11.99, 11.99),
        "Shell": (35, 65), "Whole Foods": (20, 120),
        "Trader Joe's": (15, 80), "CVS Pharmacy": (5, 40),
        "Best Buy": (20, 500), "Kroger": (15, 100),
        "Chipotle": (9, 18), "Verizon": (65, 130),
        "Comcast": (75, 150), "Delta Air Lines": (150, 800),
        "Marriott": (150, 400), "Hilton": (120, 350),
        "Planet Fitness": (10, 42), "Home Depot": (15, 300),
        "Dunkin'": (3, 10),
    }
    r = ranges.get(merchant, (5, 100))
    return rand_amount(r[0], r[1])

def pick_merchant_for_date(d: date, cat_name: str) -> tuple[str, str]:
    """Pick a merchant that maps to the given category."""
    candidates = [(m, aliases, cat) for m, aliases, cat in MERCHANTS if cat == cat_name]
    if not candidates:
        # Fallback: pick a merchant from Shopping
        candidates = [(m, aliases, cat) for m, aliases, cat in MERCHANTS if cat == "Shopping"]
    if not candidates:
        return ("Generic Store", "Shopping")
    m = random.choice(candidates)
    return (m[0], m[2])

def gen_line_item_product(merchant_name: str, fallback_idx: int) -> tuple[str, str]:
    """Return a realistic receipt line name and matching item-type category."""
    catalog = PRODUCT_CATALOG.get(merchant_name)
    if catalog:
        return random.choice(catalog)
    item_type = random.choice(ITEM_TYPES)
    return (f"{item_type} purchase #{fallback_idx + 1}", item_type)

def is_weekend(d: date) -> bool:
    return d.weekday() >= 5

def daily_txn_count(d: date) -> int:
    """Realistic number of transactions per day."""
    base = 3
    if is_weekend(d):
        base += 1  # more shopping on weekends
    if d.weekday() == 0:  # Monday
        base += 1  # start of week
    if d.day in [1, 15]:  # typical paydays
        base += 1
    if d.month == 12 and d.day >= 15:  # holiday season
        base += 2
    return max(1, int(random.gauss(base, 1.5)))

# Track monthly spending per user to keep it realistic
monthly_spend: dict[str, Decimal] = defaultdict(Decimal)
txn_seq = 0

for d in daterange(START_DATE, END_DATE):
    for uk, uinfo in user_map.items():
        hh_id = uinfo["hh_id"]
        uid = uinfo["id"]
        num_txns = daily_txn_count(d) // len(user_map) + (1 if random.random() < 0.3 else 0)

        for _ in range(num_txns):
            # Pick a category
            cat_name = pick_weighted(SPEND_PATTERNS)

            # Pick subcategory or use parent
            subcats = SUBCAT_WEIGHTS.get(cat_name, {})
            if subcats:
                sub_name = pick_weighted(subcats)
                cat_id = category_map.get(sub_name, category_map[cat_name])
            else:
                cat_id = category_map[cat_name]

            # Pick merchant
            merchant_name, merchant_cat = pick_merchant_for_date(d, cat_name)
            amount = gen_merchant_txn_date(d, merchant_name)
            if amount is None:
                continue

            # Pick account (usually checking or credit)
            accts = acct_map[uk]
            spending_accts = [a for a in accts if a[1] in ("checking", "credit")]
            if not spending_accts:
                continue
            acct_id, acct_type, acct_currency = random.choice(spending_accts)

            txn_seq += 1
            tid = stable_uuid(f"txn:{hh_id}:{uk}:{d.isoformat()}:{txn_seq}")
            description = gen_transaction_description(merchant_name)
            mer_id = merchant_map.get(merchant_name, "")

            status = "confirmed" if random.random() < 0.95 else "draft"

            rows["transaction"].append({
                "id": str(tid), "household_id": str(hh_id),
                "account_id": str(acct_id), "owner_user_id": str(uid),
                "merchant_id": str(mer_id) if mer_id else "",
                "amount": "-" + str(amount),  # expenses negative
                "currency": acct_currency,
                "base_amount": "-" + str(amount) if acct_currency == BASE_CURRENCY else "",
                "fx_rate": "",
                "txn_date": d.isoformat(),
                "category_id": str(cat_id),
                "status": status,
                "source_document_id": "",
                "source_channel": random.choice(["manual", "plaid", "manual", "manual"]),
                "is_shared": "f",
                "flags": str({}) if random.random() < 0.8 else str({"recurring": True}),
                "notes": description[:100],
                "confidence": str(round(random.uniform(0.7, 1.0), 2)),
                "external_id": "",
                "created_at": datetime.combine(d, datetime.min.time()).isoformat(),
            })

            # Add realistic receipt breakdowns for merchants where product detail matters.
            if random.random() < 0.55 and merchant_name in PRODUCT_CATALOG:
                num_items = rand_int(2, 6)
                remaining = abs(amount)
                for li_idx in range(num_items):
                    li_amount = remaining if li_idx == num_items - 1 else (remaining / (num_items - li_idx)) * Decimal(str(random.uniform(0.5, 1.0)))
                    li_amount = li_amount.quantize(Decimal("0.01"))
                    remaining -= li_amount
                    if li_amount < 1:
                        continue
                    item_name, item_type = gen_line_item_product(merchant_name, li_idx)
                    item_type_cat = category_map.get(item_type, "")
                    li_id = stable_uuid(f"lineitem:{tid}:{li_idx}")
                    rows["line_item"].append({
                        "id": str(li_id), "transaction_id": str(tid),
                        "name": item_name,
                        "item_type_category_id": str(item_type_cat) if item_type_cat else "",
                        "amount": str(li_amount),
                        "quantity": str(rand_int(1, 3)),
                        "confidence": str(round(random.uniform(0.7, 1.0), 2)),
                    })

            # Tag some transactions as recurring
            if random.random() < 0.08:
                tag_id = str(stable_uuid(f"tag:{hh_id}:recurring"))
                rows["transaction_tag"].append({
                    "transaction_id": str(tid), "tag_id": tag_id,
                })

# Add income transactions (positive amounts)
for uk, uinfo in user_map.items():
    hh_id = uinfo["hh_id"]
    uid = uinfo["id"]
    inc = uinfo["income"]
    inc_cat_id = category_map["Income"]
    inc_type = inc["type"]
    if inc_type == "Freelance":
        inc_type = "Salary"
    elif inc_type == "Mixed":
        inc_type = "Salary"
    inc_subcat_id = category_map[inc_type]

    is_id = income_source_map.get(f"{uk}:main")
    monthly_net = Decimal(str(inc["net"])) / 12
    freq = inc["freq"]

    cur = START_DATE.replace(day=1)
    while cur <= END_DATE:
        if freq == "semimonthly":
            pay_dates = [cur, cur.replace(day=15)]
        elif freq == "monthly":
            pay_dates = [cur.replace(day=28)]
        else:
            pay_dates = [cur]

        for pd in pay_dates:
            if pd < START_DATE or pd > END_DATE:
                continue
            accts = acct_map[uk]
            checking_accts = [a for a in accts if a[1] == "checking"]
            if not checking_accts:
                continue
            acct_id = checking_accts[0][0]
            net_var = (monthly_net / len(pay_dates)) * Decimal(str(random.uniform(0.98, 1.02)))
            net_var = net_var.quantize(Decimal("0.01"))

            txn_seq += 1
            tid = stable_uuid(f"txn:{hh_id}:{uk}:{pd.isoformat()}:income:{txn_seq}")
            employer = inc["employer"] or "Freelance Client"
            rows["transaction"].append({
                "id": str(tid), "household_id": str(hh_id),
                "account_id": str(acct_id), "owner_user_id": str(uid),
                "merchant_id": "",
                "amount": str(net_var),  # positive = income
                "currency": inc["currency"],
                "base_amount": str(net_var) if inc["currency"] == BASE_CURRENCY else "",
                "fx_rate": "",
                "txn_date": pd.isoformat(),
                "category_id": str(inc_subcat_id),
                "status": "confirmed",
                "source_document_id": "",
                "source_channel": "manual",
                "is_shared": "f",
                "flags": str({}),
                "notes": f"Paycheck - {employer}",
                "confidence": "1.0",
                "external_id": "",
                "created_at": datetime.combine(pd, datetime.min.time()).isoformat(),
            })

        if freq == "monthly":
            cur = (cur.replace(day=28) + timedelta(days=4)).replace(day=1)
        else:
            cur = (cur.replace(day=28) + timedelta(days=4)).replace(day=1)

# ── 8. FX rates (daily for the year) ──────────────────────────────────────────

for d in daterange(START_DATE, END_DATE):
    for pair in FX_PAIRS:
        base = FX_BASE_RATES[pair]
        drift = 1 + (random.random() - 0.5) * FX_VOLATILITY * 2
        seasonal = 1 + math.sin(2 * math.pi * (d.timetuple().tm_yday / 365)) * 0.02
        rate = round(base * drift * seasonal, 6)
        rows["fx_rate"].append({
            "currency_pair": pair,
            "date": d.isoformat(),
            "rate": str(rate),
        })

# ── Write CSVs ──────────────────────────────────────────────────────────────

print(f"Generating dataset in {DATA_DIR}/")
print(f"  Period: {START_DATE} → {END_DATE}")

for table_name, records in rows.items():
    if not records:
        print(f"  SKIP {table_name}: 0 rows")
        continue
    filepath = os.path.join(DATA_DIR, f"{table_name}.csv")
    with open(filepath, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=records[0].keys())
        writer.writeheader()
        writer.writerows(records)
    print(f"  {table_name}: {len(records)} rows → {filepath}")

print(f"\nTotal tables: {len(rows)}")
total_rows = sum(len(r) for r in rows.values())
print(f"Total records: {total_rows}")
print(f"\nTo load into PostgreSQL:")
print(f"  for f in {DATA_DIR}/*.csv; do")
print(f'    table=$(basename "$f" .csv)')
print(f"    psql -U postgres -d finance_app -c \"\\copy $table FROM '$f' WITH CSV HEADER;\"")
print(f"  done")
