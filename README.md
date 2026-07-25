# CodeName-Missing

**AI-assisted, privacy-first personal finance app.** Self-hosted, human-in-the-loop, cross-border aware. Built as an installable PWA with a FastAPI backend — document-driven ingestion, Plaid bank linking, and an AI analyst that remembers you.

> Money-moving writes stay `draft` until you confirm. Bank credentials are never stored. Financial data is encrypted at rest.

---

## Features

### Multi-modal ingestion
- **Document OCR** — snap a receipt, upload a PDF statement, or drop a CSV/XLSX export. PaddleOCR + vision-LLM extraction reads it; you confirm what lands.
- **Plaid bank linking** — connect US checking/savings/credit cards/loans. A scheduled sweep re-syncs every linked item every 6 hours (manual Sync for an immediate refresh), with refund detection, loan-payment auto-registration, and daily balance snapshots.
- **SMS ingestion** — Android forwarder webhook for SMS-based transaction alerts.
- **Manual entry** — quick-add transactions with category, merchant, and amount.
- **Batch uploads** — drag multiple receipts at once; the app auto-groups pages of the same receipt and keeps different purchases separate.

### AI Analyst with memory (4 modes)
- **Monitor** — proactive alerts on overspending, upcoming bills, cross-domain correlations (e.g. medical flag + recent purchases)
- **Explain** — ask anything about your finances in plain language; the analyst cites its sources
- **Plan** — payoff strategies, budget scenarios, cross-border investment guidance
- **Action** — one-tap actions (edit categories, confirm transactions, adjust budgets)

The analyst sees **every** transaction, debt, and document you upload. It retains durable facts in a pgvector-backed memory store and always knows what page and entity you are looking at. Alerts acknowledge but auto-resolve only when the underlying condition clears.

### Spend analytics
- **Categories-first spend view** — share donut, top merchants, spend-over-time bars
- **Merchant drill-down** — products and patterns per merchant, period comparisons
- **Filter toolbar** — date range, category, merchant, account
- **Transfer/refund-aware** — payment legs and refunds are netted correctly; spend numbers are real

### Money overview
- **Monthly leftover (disposable income)** — authoritative single number: income − recurring − EMIs − card minimums − discretionary spend
- **Recurring detection** — auto-detects bills, subscriptions, and income series from transaction patterns
- **Assets & equity** — RSU/ESPP/options, holdings, cash reserves
- **Safe-to-spend widget** — backed by real leftover calculation, not a hollow fallback

### Debt & credit cards
- **Cards page** — all credit cards with statement balances, due dates, minimums, and usage
- **Debt overview** — payoff projection, smart prioritization, debt coach with scenario planning
- **Loan detail** — EMI tracking, payment history, payoff comparison (snowball vs. avalanche)
- **Upcoming payments strip** — pinned due-date alerts that don't get lost in the activity feed

### Dashboard
- **Customizable widget grid** — drag, resize, add/remove widgets. Personalize appearance (theme, glass, radius, shadow, accent).
- **Onboarding templates** — pick a preset layout to get started
- **Widgets** — safe-to-spend, net worth, cash flow sankey, budget status, AI alerts, recent activity, top movers, debt overview, recurring, and more

### Cross-border
- **Multi-currency** — FX rates, base-currency normalization across all modules
- **Financial guidance** — AI ask + planning wizard with RAG-backed citations from the /corpus
- **Cross-border module** — India/US compliance checklists, remittance guidance, tax-year overviews

### Security
- **Private workspace** — one account per workspace; every query is scoped to it
- **Auth** — email+password (argon2), TOTP MFA with one-time recovery codes, JWT + rotating refresh tokens with reuse detection
- **Account recovery** — emailed password reset (single-use, expiring) and email verification
- **Rate limiting** — auth, password reset, ingestion, and analyst surfaces hardened
- **Encryption at rest** — AES-256-GCM for all uploaded documents (MinIO)
- **LLM awareness** — your data goes through your own LLM gateway; privacy-first by default
- **Spend caps** — optional rolling per-user limits on AI cost

### PWA (offline-tolerant)
Install on iOS/Android home screen. Capture receipts offline — they sync when you're back online.

## Not built yet

Listed so nothing above reads as a promise it doesn't keep:

| | Status |
|---|---|
| **Gmail ingestion** | Endpoints return `410`. Needs a Google restricted-scope assessment — see below. |
| **Web push notifications** | No VAPID keys and no subscription endpoint. The toggle records a preference; nothing is delivered. In-app and email notifications do work. |
| **WebAuthn / passkeys** | Not implemented. TOTP MFA with recovery codes is. |
| **Household sharing** | Removed. Each account is a single-user private workspace. |
| **Telegram / Discord bot** | On hold; only the data model exists. |
| **Plaid webhooks** | `/webhooks/plaid` accepts and echoes events but does no work. Scheduled sync is what keeps accounts current. Wiring it up requires verifying Plaid's `Plaid-Verification` JWT first. |

Before a public launch, also see the privacy policy and terms placeholders in
`web/app/(legal)/` — both need review by someone qualified, and Plaid production
access and Google OAuth verification each require them to be published.

---

## Architecture

```
/backend   FastAPI (async) + Celery workers (Python 3.12)
/web       Next.js App Router PWA (TypeScript, Tailwind, shadcn/ui)
/shared    Generated OpenAPI TypeScript client
/infra     Compose files, env templates
/corpus    Financial guidance source docs (RAG corpus)
/scripts   Dev scripts (type generation, Plaid sync trigger)
```

**Stack:** PostgreSQL 16 + pgvector · Redis · MinIO (S3) · Celery + Celery Beat · PaddleOCR + vision-LLM · OpenAI-compatible LLM gateway

---

## Quick start

Prereqs: Docker + Docker Compose.

```bash
cp .env.example .env          # fill in secrets (LLM API key at minimum)
make dev                      # or: docker compose up --build
```

Then:

| Service | URL |
|---|---|
| Web app | http://localhost:3000 |
| API health | http://localhost:8000/health |
| API docs (OpenAPI) | http://localhost:8000/docs |
| MinIO console | http://localhost:9001 |

Regenerate the shared TypeScript client from a running API:

```bash
make gen-types
```

### Configuring LLM

Swap providers by changing `LLM_BASE_URL` and models in `.env`:

| Provider | base_url |
|---|---|
| OpenAI | `https://api.openai.com/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| LM Studio | `http://localhost:1234/v1` (blank CHAT_MODEL) |
| Ollama | `http://localhost:11434/v1` |

### Enabling Plaid (optional)

Set `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENVIRONMENT=sandbox` in `.env`. Connect accounts from the Connections page. For sandbox testing with realistic data, log into Link with `user_transactions_dynamic` / `pass_good`.

Trigger a manual sandbox sync:

```bash
make plaid-sync       # local (docker exec)
make plaid-sync-prod  # production
```

### Gmail ingestion — currently disabled

The `/email/*` endpoints return `410 Gone`. Mailbox-wide Gmail OAuth needs a Google
restricted-scope security assessment, which this project has not been through, so
the flow is switched off rather than shipped half-approved. The parsing pipeline
still exists behind `EMAIL_LLM_PROCESSING_ENABLED` for when that changes.

Upload statements and receipts through Capture in the meantime.

---

## Local backend (no Docker)

```bash
cd backend
uv venv && source .venv/bin/activate
uv pip install -r requirements.txt
uvicorn app.main:app --reload
```

Tests:

```bash
make test                # or: cd backend && uv run --no-project pytest -q
```

---

## Project documentation

- [**Build Spec v2**](./FinanceApp_Build_Spec_v2.md) — module-by-module spec (M0–M16)
- [**Master Build Spec**](./FinanceApp_Master_Build_Spec.md) — original PRD + technical specification
- [**Finance.md**](./Finance.md) — original feature wishlist
- `docs/superpowers/` — design specs and implementation plans for post-M16 features

---

## Build philosophy

Personal/self-hosted tool: prioritize working features and clarity over production-grade hardening. Never store bank credentials. Always encrypt financial data at rest. Money-affecting writes stay `draft` until you confirm.
