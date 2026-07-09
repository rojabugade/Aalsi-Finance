# Cross-Border Personal Finance App — Build Spec v2 (Modular / One-Shot)

> **How to use this.** This spec is split into **build modules (M0–M16)**. Each module is written to be picked up and implemented in one shot: it states its dependencies, exact scope, the data it owns, its contracts, the libraries to use, the gotchas, and testable done-conditions. An agent should read **M1 (schema)** and any modules listed under "Depends on" before starting a module. Personal/self-hosted tool: prioritize working features and clarity over production-grade hardening — occasional bugs are acceptable, but never store bank credentials and always encrypt financial data at rest.

---

## Decision Log (changes from v1)

- **Bank linking:** IN, but Plaid US-only (optional). India/other countries → document/email/SMS ingestion (Account Aggregator needs entity registration an individual can't get).
- **Stack:** chosen freely below; not constrained to any prior preference.
- **Mobile:** installable **PWA** (Next.js), responsive for phone + desktop, one codebase. RN/Expo is a future upgrade path, not built now.
- **OCR:** free — PaddleOCR + vision-LLM extraction.
- **LLM provider:** OpenAI-compatible gateway (OpenAI / OpenRouter / LM Studio / Ollama), swappable via `base_url`.
- **Vector store:** pgvector.
- **Queue:** Celery + Redis (+ Celery Beat).
- **Investment/guidance module:** multi-country, government + community consensus, RAG with citations (reframed from compliance to accuracy/verifiability).
- **Income:** full depth incl. equity comp (RSU/ESPP/options), bonus, variable income — from day one.
- **Multi-user:** household model.
- **SMS:** Android forwarder→webhook workaround.
- **Dropped:** data residency, monetization/billing, licensing/publishing compliance, enterprise security gates.

---

## Locked Stack

- **Backend:** Python 3.12, FastAPI (async), Pydantic v2, SQLAlchemy 2.x + Alembic.
- **Workers:** Celery + Redis (broker/result/cache); Celery Beat for schedules.
- **DB:** PostgreSQL 16 + `pgvector`.
- **Object storage:** MinIO (S3-compatible, self-host) — local disk fallback in dev. Server-side encryption on; signed-URL access.
- **LLM gateway:** OpenAI Python SDK pointed at a configurable `base_url`. Chat + vision (multimodal) + embeddings.
- **OCR:** PaddleOCR (primary), Tesseract fallback; structured extraction via vision-LLM.
- **Frontend:** Next.js (App Router) + React + TypeScript, Tailwind + shadcn/ui, built as an installable PWA (`next-pwa` or App Router PWA manifest + service worker). Local-first capture via IndexedDB (Dexie) + background sync.
- **Auth:** email+password (argon2 via `passlib`), TOTP MFA (`pyotp`), JWT access + rotating refresh tokens; optional WebAuthn/passkeys in the PWA for biometric unlock.
- **Type sharing:** FastAPI emits OpenAPI; generate the TS client with `openapi-typescript` + a thin fetch client. The OpenAPI schema is the contract between tiers.
- **Bot:** `python-telegram-bot`, `discord.py`.
- **Bank linking:** Plaid (`plaid-python`), US only, optional.
- **Email ingestion:** Gmail API (`google-api-python-client`), read-only, personal GCP OAuth in testing mode, optional.
- **SMS ingestion:** off-the-shelf Android "SMS→HTTP" forwarder posting to a webhook, optional.
- **Packaging:** Docker + Docker Compose (one `docker-compose.yml` brings up Postgres+pgvector, Redis, MinIO, API, worker, beat, web).
- **Repo layout:** `/backend` (FastAPI + Celery), `/web` (Next.js), `/shared` (generated OpenAPI types), `/infra` (compose, env templates), `/corpus` (guidance source docs for M10).

---

## Module Map (dependency-ordered)

| ID | Module | Depends on |
|----|--------|-----------|
| M0 | Project foundation & infrastructure | — |
| M1 | Database schema & migrations | M0 |
| M2 | Auth & household / multi-user | M1 |
| M3 | LLM gateway | M0 |
| M4 | Document ingestion & storage | M1, M2 |
| M5 | OCR & extraction pipeline | M3, M4 |
| M6 | Transactions, line items & categorization | M1, M3, M5 |
| M7 | Analytics, faceted rollups, budgets & recommendations | M6 |
| M8 | Debt & loan management | M1, M2 |
| M9 | Income, salary & equity compensation | M1, M5, M14 |
| M10 | Multi-country financial guidance & investment education | M1, M3 |
| M11a | Bank linking (Plaid, US) | M6 |
| M11b | Email ingestion (Gmail OAuth) | M5, M6 |
| M11c | SMS ingestion (Android forwarder) | M5, M6 |
| M12 | Conversational bot (Telegram + Discord) | M5, M6, M7 |
| M13 | Notifications, reminders & scheduler | M1, M8 |
| M14 | Multi-currency & FX | M1 |
| M15 | Frontend PWA (web + installable mobile) | API from M2–M14 |
| M16 | Export, data controls & settings | M1, M2 |

**Module template (used throughout):** *Goal · Depends on · Build · Don't build · Data · Contracts · Approach & libs · Watch out · Done when.*

---

# M0 — Project Foundation & Infrastructure

**Goal:** A runnable skeleton: `docker compose up` brings up all services; API responds to `/health`; web renders a shell.

**Depends on:** —

**Build:**
- Repo layout (`/backend`, `/web`, `/shared`, `/infra`, `/corpus`).
- `docker-compose.yml`: services `postgres` (pgvector image), `redis`, `minio`, `api`, `worker` (Celery), `beat` (Celery Beat), `web`.
- Backend skeleton: FastAPI app, settings via `pydantic-settings` reading `.env`, SQLAlchemy async engine, Alembic configured, Celery app wired to Redis, `/health` and `/version` endpoints, structured JSON logging, request-ID middleware.
- Web skeleton: Next.js App Router, Tailwind + shadcn/ui, PWA manifest + service worker, API client stub, `.env` for `NEXT_PUBLIC_API_URL`.
- `.env.example` for every service; a `make dev` / README to run everything.
- A `scripts/gen-types.sh` that pulls OpenAPI from the API and regenerates `/shared` TS types.

**Don't build:** any feature logic, auth, or schema (those are M1+).

**Data:** none.

**Contracts:** `GET /health → {status:"ok"}`, `GET /version → {version, commit}`.

**Approach & libs:** FastAPI, uvicorn, SQLAlchemy 2 async + asyncpg, Alembic, Celery, redis, pydantic-settings, structlog; Next.js, next-pwa, Tailwind, shadcn/ui.

**Watch out:** Use the `pgvector/pgvector:pg16` Postgres image (or run `CREATE EXTENSION vector` in M1 migration). Keep secrets out of the image; mount via env. CORS configured for the web origin.

**Done when:** `docker compose up` yields a green `/health`, the web shell loads and is installable as a PWA, and `gen-types.sh` produces a `/shared` types file.

---

# M1 — Database Schema & Migrations

**Goal:** The full relational schema (with pgvector) and Alembic migrations. Everything else references these tables.

**Depends on:** M0.

**Build:** All tables below as SQLAlchemy models + one Alembic migration. Enable `vector` extension. Every household-scoped table has `household_id` and is indexed on it. Money stored as `NUMERIC(18,2)`; every monetary row also carries `currency` and a `base_amount` in the household base currency plus the `fx_rate` used.

**Tables (key columns):**
- **household** (id, name, base_currency, created_at)
- **user** (id, household_id→household, email unique, password_hash, display_name, locale, role[owner|member|viewer], mfa_secret nullable, created_at)
- **refresh_token** (id, user_id, token_hash, expires_at, revoked bool)
- **account_logical** (id, household_id, owner_user_id nullable, label, type[checking|savings|credit|cash|loan|investment], currency, is_shared bool, mask nullable, plaid_item_id nullable, plaid_account_id nullable) — *labels only; never store bank credentials.*
- **plaid_item** (id, household_id, access_token_encrypted, institution_name, status, created_at) — M11a.
- **document** (id, household_id, uploaded_by_user_id, storage_key, type[receipt|statement|paystub|invoice|csv|other], source_channel[upload|email|sms|bot|plaid|manual], status[uploaded|processing|needs_review|processed|failed], ocr_meta jsonb, created_at)
- **transaction** (id, household_id, account_id, owner_user_id nullable, merchant_id nullable, amount NUMERIC, currency, base_amount NUMERIC, fx_rate, txn_date date, category_id nullable, status[draft|confirmed], source_document_id nullable, source_channel, is_shared bool, flags jsonb[business,reimbursable,recurring], notes, confidence float, external_id nullable, created_at) — `external_id` unique-per-source for dedup (Plaid txn id, email msg id).
- **line_item** (id, transaction_id→transaction, name, item_type_category_id nullable, amount NUMERIC, quantity nullable, confidence float)
- **merchant** (id, household_id nullable, canonical_name, aliases jsonb, default_category_id nullable) — household_id null = global seed merchant.
- **category** (id, household_id nullable, parent_id nullable, name, kind[category|subcategory|item_type], is_system bool) — self-referential hierarchy; system categories have household_id null.
- **tag** (id, household_id, name); **transaction_tag** (transaction_id, tag_id); **line_item_tag** (line_item_id, tag_id)
- **rule** (id, household_id, matcher jsonb{field,op,value}, action jsonb{set_category|add_tag}, priority int, source[user|system], created_at)
- **budget** (id, household_id, category_id, period[monthly|quarterly|yearly], amount NUMERIC, currency)
- **loan** (id, household_id, owner_user_id, name, type[credit_card|personal|auto|education|home|other], schedule_kind[revolving|amortizing|emi], principal NUMERIC, currency, interest_rate NUMERIC, compounding[monthly|daily], min_or_emi_amount NUMERIC, due_day int, penalty_rules jsonb, start_date, end_date nullable)
- **payment_schedule** (id, loan_id, installment_no int, due_date, principal_component NUMERIC, interest_component NUMERIC, balance_after NUMERIC, status[due|paid|late])
- **income_source** (id, household_id, owner_user_id, employer, country, currency, frequency[weekly|biweekly|semimonthly|monthly|annual], gross NUMERIC, net NUMERIC, withholding jsonb)
- **paystub** (id, income_source_id, source_document_id nullable, period_start, period_end, gross NUMERIC, deductions jsonb, net NUMERIC)
- **equity_grant** (id, income_source_id, type[rsu|espp|iso|nso], ticker, country, grant_date, shares NUMERIC, strike_price nullable, vesting_schedule jsonb)
- **equity_event** (id, equity_grant_id, type[vest|purchase|sale], event_date, shares NUMERIC, fmv NUMERIC, proceeds nullable, est_tax jsonb)
- **fx_rate** (currency_pair PK-part, date PK-part, rate NUMERIC) — composite PK (currency_pair, date).
- **cross_border_transfer** (id, household_id, owner_user_id, direction[out|in], from_currency, to_currency, amount NUMERIC, fx_rate, purpose, channel, transfer_date)
- **guidance_doc** (id, country, topic, title, body text, source_url, source_type[govt|community|other], effective_date, embedding vector(1536)) — M10 RAG corpus.
- **recommendation** (id, household_id, user_id nullable, type, payload jsonb, supporting_refs jsonb, generated_at, dismissed bool)
- **notification** (id, household_id, user_id, type, channel[push|email|inapp|bot], payload jsonb, scheduled_for, status[pending|sent|failed|read])
- **bot_link** (id, user_id, platform[telegram|discord], platform_user_id, token, consent jsonb, linked_at)
- **consent_record** (id, user_id, channel[sms|email|bot|plaid], granted bool, granted_at, revoked_at nullable)
- **llm_usage_log** (id, user_id nullable, provider, model, tokens_in, tokens_out, cost_est NUMERIC, purpose, created_at)
- **audit_log** (id, household_id, actor_user_id, action, entity, before jsonb, after jsonb, ts)

**Contracts:** none (data layer). Expose SQLAlchemy models + a `get_session` dependency.

**Approach & libs:** SQLAlchemy 2 async, Alembic, pgvector SQLAlchemy types.

**Watch out:** All queries in later modules MUST filter by `household_id` (enforced via a session-scoped helper). Embedding dim must match the embedding model chosen in M3 (default 1536; make it a setting). Seed a starter category taxonomy + common global merchants in the migration.

**Done when:** `alembic upgrade head` builds the full schema, `vector` extension is present, seeds load, and a smoke test inserts/reads one row per table.

---

# M2 — Auth & Household / Multi-User

**Goal:** Secure auth with households (you + family), roles, and strict per-household data isolation.

**Depends on:** M1.

**Build:**
- Signup creates a household + owner user (or join an existing household via invite token).
- Login → JWT access (short) + refresh (rotating, stored hashed in `refresh_token`); logout revokes.
- TOTP MFA enroll/verify (`pyotp`, QR provisioning URI).
- Optional WebAuthn/passkey registration + assertion for biometric unlock on the PWA.
- Household management: invite member (email + role), list members, change role, remove member.
- Roles: `owner` (full), `member` (own + shared data), `viewer` (read-only).
- A `current_user` FastAPI dependency that yields user + household and a `scoped_query` helper enforcing `household_id`. Personal vs shared visibility: `member` sees shared items + their own `owner_user_id` items; not other members' personal items.

**Don't build:** social login, SSO, org/multi-household tenancy.

**Data:** household, user, refresh_token, consent_record, audit_log.

**Contracts:**
- `POST /auth/signup`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`
- `POST /auth/mfa/enroll`, `POST /auth/mfa/verify`
- `POST /auth/webauthn/register`, `POST /auth/webauthn/login` (optional)
- `GET /household`, `POST /household/invite`, `POST /household/join`, `GET /household/members`, `PATCH /household/members/{id}`, `DELETE /household/members/{id}`

**Approach & libs:** passlib[argon2], python-jose or pyjwt, pyotp, webauthn (py_webauthn).

**Watch out:** Hash refresh tokens at rest; rotate on every refresh and detect reuse. Every downstream endpoint depends on `current_user` and uses `scoped_query`. Don't leak other members' personal (`is_shared=false`, different `owner_user_id`) rows.

**Done when:** A user can sign up, enable MFA, log in, invite a second member, and verify that personal items aren't visible cross-member while shared items are.

---

# M3 — LLM Gateway

**Goal:** One provider-agnostic interface for chat, vision, and embeddings, swappable between OpenAI / OpenRouter / LM Studio / Ollama via config, with schema-constrained JSON output and usage logging.

**Depends on:** M0.

**Build:**
- A `LLMClient` wrapping the OpenAI SDK with configurable `base_url`, `api_key`, and model names (`CHAT_MODEL`, `VISION_MODEL`, `EMBED_MODEL`) from settings.
- Methods: `chat(messages, tools?, json_schema?) -> dict`, `vision(image_bytes|url, prompt, json_schema?) -> dict`, `embed(texts) -> list[vector]`.
- **Schema-constrained output:** when `json_schema` is given, request structured output (use the provider's JSON/structured mode if available; otherwise prompt for JSON), then validate with Pydantic and **auto-repair once** (re-ask with the validation error) before failing.
- Retry with backoff on transient errors; timeout; provider-agnostic error mapping.
- Log every call to `llm_usage_log` (provider, model, tokens, cost estimate, purpose tag).
- A tiny cache (Redis) keyed on (model, prompt hash) for idempotent calls like categorization/embedding.

**Don't build:** provider-specific features that don't exist across all targets; fine-tuning.

**Data:** llm_usage_log.

**Contracts:** internal Python API (above). No HTTP endpoint except an optional `POST /admin/llm/ping` for diagnostics.

**Approach & libs:** `openai` Python SDK (works against any OpenAI-compatible `base_url`), tenacity for retries, Pydantic for schema validation.

**Watch out:** Local models (LM Studio/Ollama) may not support structured-output mode or vision — detect capabilities via settings flags and degrade to prompt-based JSON / skip vision. Keep `EMBED_MODEL` dim consistent with M1's `vector(N)`. Never send more PII than needed; allow a redaction hook.

**Done when:** The same code path produces valid categorization JSON against OpenAI, OpenRouter, and a local LM Studio endpoint by only changing env vars, and usage is logged.

---

# M4 — Document Ingestion & Storage

**Goal:** Upload any supported document, store it encrypted, and track its processing lifecycle.

**Depends on:** M1, M2.

**Build:**
- `POST /documents` (multipart) → store to MinIO under `household/{id}/...`, create `document` row (`status=uploaded`, `source_channel`), enqueue the OCR job (M5).
- `GET /documents` (list, filter by status/type), `GET /documents/{id}` (status + extracted summary), `GET /documents/{id}/file` (short-lived signed URL).
- Accept images (JPG/PNG/HEIC), PDF, CSV. HEIC→JPEG conversion server-side. Multi-page PDFs split into page refs.
- CSV path: a schema-mapping step (map columns → {date, description, amount, currency}) saved per source label and reused.
- Internal hooks so M11a/b/c and M12 can create `document` rows with the right `source_channel` and feed the same pipeline.

**Don't build:** OCR itself (M5), transaction creation (M6).

**Data:** document.

**Contracts:** endpoints above; internal `create_document(household, file, channel) -> document` and `enqueue_ocr(document_id)`.

**Approach & libs:** boto3/minio SDK, pillow + pillow-heif, pypdf for splitting, python-multipart.

**Watch out:** Enforce file-type/size limits; virus-scan optional. Signed URLs short-lived. Don't block the request on OCR — enqueue and return immediately. Store original bytes; derived images separately.

**Done when:** Uploading a multi-page PDF and a HEIC photo both produce stored, encrypted documents in `processing`, retrievable via signed URL, with an OCR job enqueued.

---

# M5 — OCR & Extraction Pipeline

**Goal:** Turn a stored document into normalized, confidence-scored, schema-valid structured data (transactions, line items, or paystub fields), with a human review queue for low-confidence results.

**Depends on:** M3, M4.

**Build (Celery task chain):**
1. **Load** document from storage.
2. **OCR text** with PaddleOCR (Tesseract fallback). For PDFs with embedded text, extract directly (pypdf) before falling back to OCR.
3. **Structured extraction via vision-LLM** (M3 `vision` with a per-doc-type `json_schema`):
   - *receipt/invoice* → {merchant, date, currency, subtotal, tax, total, line_items:[{name, amount, qty?}]}
   - *bank statement* → {account_hint, transactions:[{date, description, amount, balance?}]} (no line items)
   - *paystub* → {employer, period_start, period_end, gross, deductions[], net}
   - *csv* → use the saved mapping, no LLM.
4. **Normalize:** canonicalize merchant, ISO dates, signed amounts, currency; per-field `confidence`.
5. **Reconcile** (handoff to M6) and **route**: high confidence → draft transactions auto-created; low → `needs_review`.
6. Update `document.status` and `ocr_meta`.

**Don't build:** paid OCR providers; the transaction persistence rules (M6 owns them).

**Data:** writes `ocr_meta` on document; emits structured payloads to M6.

**Contracts:** Celery task `process_document(document_id)`; emits typed payloads consumed by M6's `ingest_extraction(document_id, payload)`. A `GET /review-queue` and `POST /review-queue/{document_id}/resolve` (user confirms/edits → commit).

**Approach & libs:** paddleocr, pytesseract, pypdf, opencv/pillow for deskew/denoise, Pydantic schemas per doc type.

**Watch out:** PaddleOCR model download size — pin and cache in the image. Multimodal extraction quality varies by model; keep the OCR-text+LLM path as a fallback when the model lacks vision. Always attach confidence and never auto-confirm below threshold. Statements give transaction-level only — do not fabricate line items.

**Done when:** A real grocery receipt yields itemized line items and a real statement yields transaction rows, each confidence-scored, with low-confidence items landing in the review queue and high-confidence ones as drafts.

---

# M6 — Transactions, Line Items & Categorization

**Goal:** The transaction core — CRUD, split/merge, recurring detection, receipt↔statement reconciliation, and a hybrid categorization engine that learns from corrections.

**Depends on:** M1, M3, M5.

**Build:**
- **Persistence from extraction:** `ingest_extraction(...)` creates `transaction` (+ `line_item` children for receipts) as `draft`; dedups on `external_id`.
- **Reconciliation:** match receipt-derived purchases to statement transactions by amount + date window + fuzzy merchant; on match, attach line items to the statement transaction and drop the duplicate total; expose manual link/unlink. *This is the mechanism that unlocks the "Macy's breakdown" — a statement charge gains line items only when a receipt is linked.*
- **CRUD + ops:** create/edit/confirm/delete; **split** one transaction into several; **merge**; mark refund/credit; flags (business/reimbursable).
- **Recurring detection:** detect repeating merchant+amount cadence; tag `recurring`; surface subscriptions.
- **Categorization engine (hybrid):**
  1. **Rules first** (`rule` table; merchant/keyword/amount matchers) — deterministic, free.
  2. **Fallback** — embedding similarity to taxonomy + LLM classification (M3) with confidence, for unknown merchants/items (both transaction-level and line-item/item-type level).
  3. **Feedback loop** — a user correction creates/updates a `rule` and is remembered; future identical merchants/items auto-classify.
- **Taxonomy management:** add/rename categories/subcategories/item-types; merging re-tags historical rows.

**Don't build:** analytics/rollups (M7).

**Data:** transaction, line_item, merchant, category, tag, transaction_tag, line_item_tag, rule.

**Contracts:**
- `GET/POST/PATCH/DELETE /transactions`, `POST /transactions/{id}/split`, `POST /transactions/merge`, `POST /transactions/{id}/confirm`
- `POST /transactions/{id}/line-items`, `POST /transactions/{id}/link-receipt`
- `GET/POST /categories`, `POST /categories/{id}/merge`, `GET/POST /tags`, `GET/POST /rules`
- Internal: `ingest_extraction`, `categorize(transaction|line_item)`.

**Approach & libs:** rapidfuzz (merchant fuzzy match), pgvector similarity for category embeddings, SQLAlchemy.

**Watch out:** Reconciliation must not double-count — linking a receipt to a statement charge supersedes the standalone receipt total. Rule precedence by `priority`. Re-tagging on category merge can be large — batch it. Keep everything `draft` until confirmed for money-affecting commits.

**Done when:** Uploading a Macy's receipt and the matching card statement results in one transaction carrying the itemized breakdown (pants/tops/cosmetics), correctly categorized, with a correction creating a reusable rule.

---

# M7 — Analytics, Faceted Rollups, Budgets & Recommendations

**Goal:** Fast time-series + faceted breakdowns (the "where did this number come from" view), budgets, and cited recommendations with anomaly detection.

**Depends on:** M6.

**Build:**
- **Faceted aggregation API:** group by any combination of {merchant, category, subcategory, item_type, tag} over any time window (presets + custom range) with period-over-period comparison. Output totals + contribution breakdown (e.g., Macy's = total; pants/tops/cosmetics contributions, amount-weighted; quantities optional).
- **Time-series:** monthly/quarterly/yearly/custom trend lines for spend, income, net, by category.
- **Rollup performance:** maintain rollup tables or materialized views (refreshed on transaction confirm) so multi-dimension/multi-period queries stay fast.
- **Budgets:** per-category budgets, progress, overspend alerts (feeds M13).
- **Recommendations (cited):** per-category observations grounded in the user's data ("Dining +40% vs 3-mo avg, driven by 6 DoorDash orders"), each carrying `supporting_refs` (transaction ids). Anomaly/spike detection; recurring-charge + duplicate-charge surfacing. Framed as observations, not personalized financial advice; always cite the figures.

**Don't build:** the guidance/investment module (M10).

**Data:** reads transaction/line_item; writes budget, recommendation; rollup tables.

**Contracts:**
- `GET /analytics/summary?from&to&group_by[]=...&compare=prev`
- `GET /analytics/timeseries?metric&interval&from&to`
- `GET /analytics/breakdown?dimension&filter`
- `GET/POST /budgets`
- `GET /recommendations`, `POST /recommendations/{id}/dismiss`

**Approach & libs:** SQL aggregation + materialized views; numpy/pandas for anomaly stats; M3 for the natural-language recommendation phrasing (templated + LLM polish, with refs preserved).

**Watch out:** Refresh rollups on confirm, not on every draft. Recommendations must include `supporting_refs` and never emit "buy/sell" guidance. Currency: aggregate on `base_amount`.

**Done when:** A faceted query returns the Macy's total with per-item-type contributions over a custom quarter; budgets alert on overspend; a recommendation cites the exact transactions behind it.

---

# M8 — Debt & Loan Management

**Goal:** Manage US revolving + loan and Indian EMI debts with amortization schedules, payoff calculators, and due-date/penalty safety nets.

**Depends on:** M1, M2.

**Build:**
- Create/edit debts: credit card (revolving, APR + min payment), personal/auto/education/home (amortizing), EMI (India). Fields per M1 `loan`.
- **Amortization/schedule generation:** full `payment_schedule` (principal/interest split, balance-after) for amortizing/EMI; revolving uses APR + min-payment modeling.
- **Payoff calculators:** time-to-payoff under a given monthly payment; effect of one-off extra payments; **snowball vs avalanche** comparison across multiple debts.
- **Safety net:** upcoming-due tracking, **penalty/late-fee warnings**, and "minimum-only" cost projection ("paying just the minimum costs ₹X interest and N months"). Emits reminders to M13.
- Multi-currency debts with FX context (M14).

**Don't build:** executing payments.

**Data:** loan, payment_schedule.

**Contracts:**
- `GET/POST/PATCH/DELETE /loans`
- `GET /loans/{id}/schedule`
- `POST /loans/{id}/payoff-calc` (body: monthly_payment, extra_payments[]) → projection
- `POST /loans/payoff-strategy` (body: strategy=snowball|avalanche) → ordered plan

**Approach & libs:** plain financial math (amortization formula, EMI = P·r·(1+r)^n/((1+r)^n−1)); numpy for projections.

**Watch out:** Compounding convention (monthly vs daily) per debt; handle revolving differently from amortizing. Penalty rules are per-loan jsonb — model late-fee + penalty-APR.

**Done when:** Adding an EMI loan and a US credit card produces correct schedules; payoff-calc and snowball/avalanche return sensible plans; due-date + penalty reminders fire via M13.

---

# M9 — Income, Salary & Equity Compensation

**Goal:** Full income picture — sources, paystub OCR, withholding/take-home estimates (US + India), and equity comp (RSU/ESPP/options), bonuses, variable income.

**Depends on:** M1, M5, M14.

**Build:**
- **Income sources:** multiple, with frequency, gross/net, currency, country.
- **Paystub OCR:** reuse M5 → populate `paystub` (gross, deductions, net).
- **Withholding/take-home (informational estimates):**
  - US: federal + state + FICA estimation.
  - India: TDS; **old vs new regime** comparison (illustrative).
- **Equity compensation (from day one):**
  - **RSU:** grant + vesting schedule; each vest = `equity_event(type=vest)` recognized as income at FMV; estimated tax.
  - **ESPP:** contribution, purchase (with discount), sale; qualifying vs disqualifying disposition note.
  - **Options (ISO/NSO):** grant, strike, exercise, sale; spread/bargain element note.
  - Track `equity_event`s and surface vested/unvested value and upcoming vests.
- **Bonuses & variable income:** one-off and irregular income; a smoothing view (rolling average) for budgeting.
- **Cross-border income view:** USD earnings, take-home after estimated taxes, linkage to remittances (M10). Estimates only.

**Don't build:** authoritative tax filing; precise jurisdiction tax engines (estimates suffice; deeper rules live in M10's corpus).

**Data:** income_source, paystub, equity_grant, equity_event.

**Contracts:**
- `GET/POST/PATCH /income-sources`, `POST /paystubs`
- `GET/POST /equity/grants`, `GET/POST /equity/events`, `GET /equity/summary`
- `GET /income/take-home?source_id` (estimate, with regime comparison for India)

**Approach & libs:** financial math; tax-estimate tables as config (kept current via M10 corpus references); FMV from a free quote source or manual entry.

**Watch out:** Tax estimates are illustrative — label as such and let M10 supply the consensus context. Vesting-schedule jsonb must support cliffs + periodic vesting. Equity FMV may need manual entry if no quote source.

**Done when:** Adding a salary + an RSU grant shows take-home estimates (US fed/state/FICA and India old-vs-new), recognizes vests as income at FMV, and surfaces upcoming vests.

---

# M10 — Multi-Country Financial Guidance & Investment Education

**Goal:** A RAG-backed module that answers cross-border and investment questions for **multiple countries**, surfacing **both government/official and community-consensus** sources, always cited and dated, plus a remittance tracker and a "what applies to me" wizard.

**Depends on:** M1, M3.

**Build:**
- **Curated corpus** in `/corpus`: per-country docs tagged `source_type` (govt | community | other) with `effective_date` and `source_url`, covering at minimum US + India (extensible to other countries): cross-border remittance rules/limits (e.g., India LRS, TCS, Form 15CA/15CB, FEMA, NRE/NRO), US reporting (FBAR/FinCEN 114, FATCA/Form 8938), DTAA/foreign tax credit, Schedule FA, residency tests; and **investment education** — instrument types, general taxation, and community consensus (e.g., index-fund/Bogleheads-style consensus, official investor-education material).
- **Ingestion:** load corpus → chunk → embed (M3) → store in `guidance_doc` with pgvector.
- **RAG answer endpoint:** retrieve top-k by country/topic, generate an answer that **cites the specific docs**, **distinguishes government vs community consensus**, and shows effective dates. (Accuracy posture: the answer always shows its sources so the user can verify — AI may be wrong; this is the mitigation, not a legal disclaimer.)
- **"What applies to me" wizard:** minimal questions (countries, residency, amounts, account types) → a personalized checklist + reminders (to M13) + cited links.
- **Remittance tracker:** log US↔India (and other) transfers (`cross_border_transfer`) with purpose/FX; running totals vs relevant annual limits; proximity alerts.

**Don't build:** personalized "buy this specific asset" recommendations — keep it to instrument types + general/consensus considerations. No money movement.

**Data:** guidance_doc, cross_border_transfer.

**Contracts:**
- `POST /guidance/ask` (body: question, country) → {answer, citations:[{title, source_url, source_type, effective_date}]}
- `POST /guidance/wizard` → checklist + reminders
- `GET/POST /cross-border/transfers`, `GET /cross-border/limits`
- `POST /admin/corpus/reindex` (rebuild embeddings)

**Approach & libs:** pgvector retrieval, M3 for generation with citation-preserving prompts; a small corpus-loader script.

**Watch out:** Never hardcode rates/limits as fact in code — they live in the dated corpus and must be refreshable. Always return citations; if retrieval is empty, say so rather than guessing. Make `country` a first-class filter so it generalizes beyond US-India.

**Done when:** Asking a US-India remittance question returns a cited answer separating government rules from community consensus with effective dates; the wizard yields a personalized checklist; the remittance tracker warns near a limit.

---

# M11a — Bank Linking (Plaid, US) — *optional*

**Goal:** Optional US bank linking via Plaid to import transactions into the same pipeline, with no credential storage.

**Depends on:** M6.

**Build:**
- Plaid Link flow: backend creates a `link_token`; frontend opens Plaid Link; on success, exchange `public_token` → `access_token` (stored **encrypted** in `plaid_item`).
- Map Plaid accounts → `account_logical` (`plaid_account_id`, mask).
- Transaction sync (`/transactions/sync`) → create `document`(channel=plaid) + feed `ingest_extraction` (M6) with dedup on Plaid `transaction_id` (`external_id`).
- Webhook handler for updates; manual "refresh" endpoint.
- Consent recorded (`consent_record`).

**Don't build:** non-US aggregators; India Account Aggregator (not available to an individual).

**Data:** plaid_item; writes account_logical + transactions via M6.

**Contracts:** `POST /plaid/link-token`, `POST /plaid/exchange`, `POST /plaid/sync`, `POST /webhooks/plaid`, `DELETE /plaid/items/{id}`.

**Approach & libs:** plaid-python; encrypt `access_token` with a KMS/Fernet key from settings.

**Watch out:** Never log/store bank credentials — Plaid Link handles them; you only keep the token, encrypted. Verify current Plaid pricing/tier limits before relying on it. Cursor-based sync for incremental updates.

**Done when:** Linking a Plaid Sandbox institution imports transactions (deduped) into the same review/confirm flow, with the token stored encrypted.

---

# M11b — Email Ingestion (Gmail OAuth) — *optional*

**Goal:** Optionally read transaction emails / e-statements from the user's own Gmail (read-only) and feed the pipeline. Plus a no-OAuth forward-to-address fallback.

**Depends on:** M5, M6.

**Build:**
- OAuth (read-only `gmail.readonly`) via a personal GCP project in **testing mode** (no security assessment needed for a handful of test users — verify the current test-user cap). Store refresh token encrypted.
- Poll/query for transaction emails + statement attachments (filtered by sender/subject patterns, user-configurable) → create `document`(channel=email) → M5 extraction → M6 (dedup on message id via `external_id`).
- **Fallback (no OAuth):** an app-owned ingestion address; user forwards emails/statements there; an inbound handler creates documents.
- Consent recorded.

**Don't build:** restricted-scope production verification (not needed for personal use).

**Data:** writes document + transactions via M5/M6.

**Contracts:** `POST /email/oauth/start`, `GET /email/oauth/callback`, `POST /email/sync`, `POST /webhooks/email-inbound` (fallback), `DELETE /email/connection`.

**Approach & libs:** google-api-python-client, google-auth-oauthlib; an inbound-email provider or IMAP for the fallback address.

**Watch out:** Keep scope read-only. Encrypt the refresh token. Sender/subject filters reduce noise and avoid parsing junk. Dedup against Plaid/manual entries by amount+date+merchant in addition to message id.

**Done when:** Connecting a Gmail account (test mode) imports a bank's transaction emails and an e-statement PDF into the review flow, deduped; the forward-to-address fallback also works.

---

# M11c — SMS Ingestion (Android forwarder) — *optional, the SMS workaround*

**Goal:** Capture bank transaction SMS on Android without building a native app, by using an off-the-shelf SMS→HTTP forwarder posting to a secure webhook, then parsing with the LLM.

**Depends on:** M5, M6.

**Build:**
- A signed **webhook** `POST /webhooks/sms` accepting {from, body, received_at} from an Android SMS-forwarding app (e.g., a configurable "SMS to URL" forwarder). Auth via a per-user secret token (issued in settings, tied to `consent_record`).
- LLM parse (M3, schema-constrained) of the SMS body → {merchant, amount, currency, date, type[debit|credit]} → create `document`(channel=sms) + draft transaction (M6), low-confidence → review queue.
- A short setup guide (in `/docs`) for installing/configuring a forwarder app and pasting the webhook URL + token.
- Consent + per-sender allowlist (only forward bank senders).

**Why this design:** iOS blocks third-party SMS reading at the OS level (not just policy) — no workaround there; use email/manual for iOS. Android *can* read SMS, and for a personal (sideloaded/off-the-shelf) setup there's no Play-policy barrier — a forwarder app is the lowest-effort, no-mobile-dev path.

**Don't build:** a custom native Android SMS-reader app (unnecessary; mobile dev not wanted).

**Data:** writes document + transactions via M5/M6.

**Contracts:** `POST /webhooks/sms` (token-authed), `POST /sms/token/rotate`, `DELETE /sms/connection`.

**Approach & libs:** any maintained Android "SMS forwarder to webhook" app; backend LLM parse + HMAC/token verification.

**Watch out:** Validate the token + sender allowlist; rate-limit. Bank SMS formats vary — rely on the LLM parser with confidence + review, not brittle regex. Treat as Android-only; document the iOS limitation.

**Done when:** A forwarded bank SMS produces a parsed draft transaction in the review queue, authenticated by the per-user token, restricted to allowlisted senders.

---

# M12 — Conversational Bot (Telegram + Discord)

**Goal:** Log expenses (photo or natural language) and query finances conversationally, as a thin client over the API.

**Depends on:** M5, M6, M7.

**Build:**
- **Account linking:** `/start` issues/accepts a one-time code mapping `platform_user_id` → user (`bot_link`), with consent.
- **Photo logging:** send a receipt photo → creates `document`(channel=bot) → M5 → draft → inline confirm button.
- **NL logging:** "spent ₹1,200 on groceries at DMart" → M3 parse → draft transaction → confirm.
- **Queries:** "how much on dining this month?" → M7 analytics → concise reply.
- **Reminders:** receive pushes from M13.
- Both Telegram and Discord, sharing one handler layer that calls the same backend services.

**Don't build:** a separate AI brain — the bot calls existing endpoints/services.

**Data:** bot_link; writes via M5/M6.

**Contracts:** `POST /bot/link` (issue code), `POST /webhooks/telegram`, `POST /webhooks/discord`; internal handlers → existing services.

**Approach & libs:** python-telegram-bot (webhook), discord.py; inline keyboards/buttons for confirmations.

**Watch out:** **Privacy** — financial data transits a third party: explicit opt-in, never echo full account numbers, minimize sensitive content. Confirmations keep human-in-the-loop. Respect platform rate limits + ToS.

**Done when:** After linking, a photo and a "spent X at Y" message both create confirmed transactions, a spend query returns the correct figure, and no full account numbers are ever shown.

---

# M13 — Notifications, Reminders & Scheduler

**Goal:** Multi-channel reminders and alerts (due dates, penalties, budgets, review-queue nudges, cross-border obligations) with a scheduler.

**Depends on:** M1, M8.

**Build:**
- A `notification` queue + dispatcher across channels: **push** (web push for the PWA via VAPID), **email**, **in-app**, **bot** (M12).
- **Scheduler (Celery Beat):** periodic jobs scan for upcoming loan/EMI due dates, penalty risks (M8), budget overspend (M7), pending review items (M5), and cross-border reminders (M10) → enqueue notifications.
- User-configurable channel preferences + quiet hours.
- In-app notification center.

**Don't build:** SMS-out (not needed).

**Data:** notification.

**Contracts:** `GET /notifications`, `POST /notifications/{id}/read`, `GET/PATCH /notifications/preferences`; internal `enqueue_notification(...)`.

**Approach & libs:** Celery Beat, pywebpush (VAPID), an email sender (SMTP), reuse M12 for bot.

**Watch out:** Idempotent scheduling (don't double-send); respect preferences/quiet hours; web push requires service-worker registration in M15.

**Done when:** A loan due in N days, a budget overspend, and a stale review item each generate a notification delivered to the chosen channels.

---

# M14 — Multi-Currency & FX

**Goal:** Base currency per household, per-transaction currency, and accurate historical conversion via stored FX snapshots.

**Depends on:** M1.

**Build:**
- Daily FX refresh (free source) into `fx_rate` (e.g., USD/INR and any used pairs).
- On transaction create, snapshot the rate for `txn_date` and compute `base_amount`; store both.
- Conversion helpers for analytics (aggregate on `base_amount`), debts, income, transfers.
- Household base-currency setting (USD or INR or other).

**Don't build:** live trading rates; FX execution.

**Data:** fx_rate; sets base_amount/fx_rate on monetary rows.

**Contracts:** `GET /fx/rates?pair&date`; internal `convert(amount, from, to, date)`.

**Approach & libs:** a free FX rate API (e.g., a no-key/public source) or a daily file; Celery Beat job to refresh.

**Watch out:** Always store the historical rate on the row so past reports don't shift when rates change. Handle missing-date rates (use nearest prior).

**Done when:** A transaction in INR shows a correct base-currency value using the rate on its date, and analytics aggregate consistently in base currency.

---

# M15 — Frontend PWA (Web + Installable Mobile)

**Goal:** One installable, responsive Next.js PWA covering phone + desktop, with offline capture and all feature surfaces.

**Depends on:** APIs from M2–M14.

**Build (independently buildable surfaces):**
- **Shell & PWA:** installable (manifest + service worker), responsive layout, auth screens (login/MFA/passkey), offline shell.
- **Capture:** camera + file upload (works offline via IndexedDB/Dexie, syncs when online); CSV mapping wizard.
- **Review queue:** confirm/edit low-confidence extractions; link receipts to statement charges.
- **Dashboard:** spend/income/net, top categories, trends; **time filters** (presets + custom + compare).
- **Transactions:** list/search/filter, edit/split/merge, tags, flags, line-item breakdown view (the Macy's drill-down).
- **Analytics/breakdowns:** faceted views (merchant/category/item-type/tag) with contribution charts.
- **Budgets.**
- **Debt:** loans, schedules, payoff calculators, snowball/avalanche.
- **Income:** sources, paystubs, take-home estimates, equity (grants/vests/ESPP/options).
- **Guidance:** ask (cited answers, govt vs community), wizard, remittance tracker.
- **Connections:** Plaid link, Gmail connect, SMS token + setup guide, bot linking.
- **Notifications center + preferences.**
- **Settings/household:** members/roles, base currency, language (English + Hindi/Hinglish), data controls (export/delete).

**Don't build:** native iOS/Android apps (PWA covers it; RN/Expo is a later upgrade).

**Data:** none (consumes API).

**Contracts:** consumes the generated OpenAPI TS client (`/shared`).

**Approach & libs:** Next.js App Router, Tailwind, shadcn/ui, TanStack Query, Recharts (or similar) for charts, Dexie for offline, next-pwa/Workbox for SW + web push registration, WebAuthn for passkeys.

**Watch out:** Offline capture must queue and sync without loss/duplication. Charts must read base-currency aggregates. i18n via next-intl (English + Hindi/Hinglish). Keep "layman UX": each screen leads with one clear takeaway, drill-downs are opt-in.

**Done when:** The app installs to a phone home screen and desktop, captures a receipt offline and syncs it, and every backend feature has a usable surface, in both English and Hindi/Hinglish.

---

# M16 — Export, Data Controls & Settings

**Goal:** User data ownership — export, delete, and core settings.

**Depends on:** M1, M2.

**Build:**
- **Export:** transactions + line items + loans + income to CSV; a PDF summary report.
- **Delete:** delete a connection (Plaid/email/SMS/bot revokes token + consent) and full-account delete (cascade with confirmation + audit).
- **Settings:** base currency, language, notification preferences (links to M13), consent management (`consent_record`).

**Don't build:** complex DSAR tooling (personal use).

**Data:** reads across; writes consent_record, audit_log.

**Contracts:** `GET /export?format=csv|pdf`, `DELETE /account`, `GET/PATCH /settings`, `GET /consents`, `POST /consents/{channel}/revoke`.

**Approach & libs:** pandas (CSV), a PDF lib (reportlab/weasyprint).

**Watch out:** Full delete is destructive — require explicit confirmation and write an audit entry. Revoking a connection must invalidate its token.

**Done when:** A user can export all data to CSV/PDF, revoke any connection, and delete their account with confirmation and an audit trail.

---

## Glossary (multi-country, used above)

LRS (India outbound remittance cap) · TCS (tax collected at source on certain foreign remittances, India) · FEMA (Foreign Exchange Management Act, India) · NRE/NRO (non-resident account types, India) · Form 15CA/15CB (remittance declarations, India) · Schedule FA (foreign assets schedule, Indian ITR) · DTAA (double-taxation avoidance / foreign tax credit) · FBAR (FinCEN Form 114, US foreign-account report) · FATCA / Form 8938 (US foreign-asset reporting) · EMI (equated monthly installment, India loans) · RSU/ESPP/ISO/NSO (equity compensation instruments) · RIA (registered investment adviser — relevant only if ever published, not now).

*All rates, limits, and tax figures are illustrative of what the M10 corpus must cover; they live in dated, cited corpus docs and must be kept current — this is a build spec, and for a personal tool the verification mechanism is the citations the app shows you, not legal disclaimers.*
