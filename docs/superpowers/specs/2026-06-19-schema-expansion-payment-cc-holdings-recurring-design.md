# Schema Expansion: Payment Methods, Credit-Card Detail, Investment Holdings, Recurring Series

**Date:** 2026-06-19
**Status:** Approved (design)
**Scope:** Backend data model only (ORM + Alembic migration + schema tests). No API/UI/business logic in this spec.

## Motivation

A supplied ER diagram (`finance_app_er_diagram.mmd`) modeled a single-user personal-finance app. Our project's spine matches it on ~9 entities but is missing four the user wants:

- **Payment method** — track card/bank/wallet used per transaction.
- **Credit-card statement detail** — limit, statement balance, available credit, statement cycle.
- **Investment holdings** — brokerage positions with valuation history.
- **Recurring series** — *data about recurring events only; no payment-execution engine.*

`Goal` is intentionally **out of scope** (deferred per user).

Two diagram entities already exist in this codebase under different shapes and are **not** rebuilt:
- A credit card is already a `loan` row (`type=credit_card`, `schedule_kind=revolving`, `interest_rate`=APR, `min_or_emi_amount`=min payment, `due_day`).
- An investment account is already `account_logical` with `type=investment`.

## Conventions (match existing models)

- **Tenancy:** every household-scoped table carries `household_id` (indexed FK, `ON DELETE CASCADE`) plus a nullable `owner_user_id` (`ON DELETE SET NULL`). The diagram's user-centric FKs are remapped to this household-centric pattern.
- **Money:** `money()` = `NUMERIC(18,2)`; currency stored as `currency_col()` = `CHAR/VARCHAR(3)` where a row is monetary.
- **PKs:** `uuid_pk()` unless a natural composite/1:1 key applies.
- **Migration:** a single new Alembic revision chained off the current head `f3c8d1e0a7b2` (M17).

## New Tables

### 1. `payment_method`  (file: `app/models/accounts.py`)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `household_id` | uuid FK household | CASCADE, indexed |
| `owner_user_id` | uuid FK user, null | SET NULL |
| `account_id` | uuid FK account_logical, null | SET NULL; the funding account |
| `type` | str enum | `card` \| `bank` \| `wallet` \| `cash` |
| `name` | str | display label |
| `last4` | str(4), null | |
| `network` | str, null | visa \| mastercard \| amex \| rupay \| … |
| `is_active` | bool | default true |

**Transaction change:** add `payment_method_id` uuid FK → `payment_method.id`, nullable, `ON DELETE SET NULL`.

### 2. `credit_card_detail`  (file: `app/models/debt.py`)

1:1 extension of a credit-card `loan`.

| Column | Type | Notes |
|---|---|---|
| `loan_id` | uuid PK **and** FK loan | CASCADE; one row per CC loan |
| `credit_limit` | money | |
| `statement_balance` | money, null | |
| `available_credit` | money, null | |
| `statement_day` | int, null | day-of-month statement closes |

**Deliberately omitted** (already on `loan`, no duplication): APR (`interest_rate`), minimum payment (`min_or_emi_amount`), payment due day (`due_day`).

### 3. `investment_holding`  (file: `app/models/investments.py` — new)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `household_id` | uuid FK household | CASCADE, indexed |
| `owner_user_id` | uuid FK user, null | SET NULL |
| `account_id` | uuid FK account_logical | CASCADE; the `type=investment` account |
| `asset_type` | str enum | `stock` \| `etf` \| `mutual_fund` \| `crypto` \| `bond` \| `other` |
| `symbol` | str, null | ticker/ISIN |
| `name` | str | |
| `quantity` | NUMERIC(18,4) | |
| `avg_buy_price` | money, null | cost basis per unit |
| `currency` | currency_col | |

No live price column — current price/value lives in the snapshot table below.

### 4. `holding_valuation`  (file: `app/models/investments.py`)

Time-series, mirrors the `account_balance` pattern.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `household_id` | uuid FK household | CASCADE, indexed |
| `holding_id` | uuid FK investment_holding | CASCADE |
| `as_of` | date | |
| `price` | money | per-unit price at `as_of` |
| `value` | money | denormalized `price × quantity` |

Index `(holding_id, as_of)` for latest-snapshot / charting queries.

### 5. `recurring_series`  (file: `app/models/transactions.py`)

Template / event data only. **No scheduler, no auto-posting.**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `household_id` | uuid FK household | CASCADE, indexed |
| `owner_user_id` | uuid FK user, null | SET NULL |
| `merchant_id` | uuid FK merchant, null | SET NULL |
| `category_id` | uuid FK category, null | SET NULL |
| `account_id` | uuid FK account_logical, null | SET NULL |
| `payment_method_id` | uuid FK payment_method, null | SET NULL |
| `name` | str | |
| `amount` | money, null | typical/expected amount |
| `currency` | currency_col | |
| `cadence` | str enum | `weekly` \| `biweekly` \| `monthly` \| `quarterly` \| `annual` \| `irregular` |
| `type` | str enum | `subscription` \| `bill` \| `income` \| `transfer` \| `other` |
| `status` | str enum | `active` \| `paused` \| `ended` |
| `next_due_date` | date, null | |
| `start_date` | date, null | |
| `end_date` | date, null | |

**Transaction change:** add `recurring_series_id` uuid FK → `recurring_series.id`, nullable, `ON DELETE SET NULL`. Structured upgrade over the existing `flags.recurring` JSONB tag (which remains; the FK supersedes it for series membership).

## Transaction Table — summary of additions

Two new nullable columns, both `ON DELETE SET NULL`:
- `payment_method_id` → `payment_method.id`
- `recurring_series_id` → `recurring_series.id`

## Model Registration

Add all new classes to `app/models/__init__.py` imports and `__all__`:
`PaymentMethod`, `CreditCardDetail`, `InvestmentHolding`, `HoldingValuation`, `RecurringSeries`.

## Migration

Single Alembic revision (e.g. `m18_payment_cc_holdings_recurring`), `down_revision = "f3c8d1e0a7b2"`:
1. `create_table` for the five new tables (FKs, indexes on `household_id`, composite index on `holding_valuation(holding_id, as_of)`).
2. `add_column` `transaction.payment_method_id` + FK constraint.
3. `add_column` `transaction.recurring_series_id` + FK constraint.
4. `downgrade()` drops the two columns then the five tables in dependency-safe order.

## Testing

Schema-level tests (extend `tests/test_m1_schema.py` or new `tests/test_m18_schema.py`), run in the api container (local `.venv` is broken per project memory):
- All five tables exist with expected columns.
- `transaction.payment_method_id` and `transaction.recurring_series_id` exist and FK to the right tables.
- `credit_card_detail.loan_id` is both PK and FK to `loan` (1:1).
- `holding_valuation.holding_id` FKs to `investment_holding`.
- Insert/round-trip one row per table under a household to confirm tenancy FKs resolve.

## Out of Scope (this spec)

- `Goal` table (deferred).
- Any recurring **execution**/auto-posting engine.
- API endpoints, serializers, frontend, valuation-fetch jobs, recurring-detection logic. Those are downstream phases.
