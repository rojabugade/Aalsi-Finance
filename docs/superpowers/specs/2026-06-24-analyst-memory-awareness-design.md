# Analyst Memory & Awareness — Design

**Date:** 2026-06-24
**Branch:** `feat/analyst-memory-awareness`
**Status:** Approved design, pending implementation plan

## Goal

Turn the AI analyst from a stateless, aggregate-only assistant into a
hyper-aware module with long-term memory. It should reason over **every**
transaction, debt, budget, and uploaded document (financial, medical,
lifestyle — anything), retain durable learned facts about the user, correlate
across domains, and surface comprehensive, persistent (non-dismissable) alerts
both on demand and proactively in the background. It must always know what page
and entity the user is looking at, and cite its sources.

## Locked decisions (from brainstorming)

1. **Document privacy:** auto-include every uploaded document in analyst memory
   by default; the user can mark a specific document `private` to opt it out.
2. **Alert lifecycle:** acknowledge + auto-resolve. The user can *acknowledge*
   an alert (stops it nagging) but it stays visible until the underlying
   condition actually clears. Nothing is ever permanently user-hidden.
3. **Proactive cadence:** scheduled background analysis via Celery (on new data
   + daily), writing persistent alerts to the `notification` table.
4. **Cross-domain correlation:** in scope now (e.g. "your report flags a peanut
   allergy — but you bought peanut products twice this month").

## Current state (what exists)

- **Ask** (`backend/app/analyst/service.py::run_ask`): single-shot, stateless.
  Builds a `FinancialSnapshot` of *aggregates only* (income/expenses/net worth,
  top-5 categories, budgets, recurring, loans). Never sees an individual
  transaction or document. Optional `focus` (entity) + `page` (a single string).
- **Alerts** (`run_monitor` → `derive_alerts`): 4 hardcoded deterministic rules,
  no LLM. **Dismissable** via a frontend `localStorage` set
  (`web/components/dashboard/analyst/use-analyst.tsx`, key `cf-analyst-dismissed`).
- **Page-awareness:** one sentence appended to the prompt.

### Enablers already in the stack (do not rebuild)

- `pgvector` + `Vector(embed_dim)` column + LLM `embed()`
  (`backend/app/llm/client.py:334`), currently wired only to an unused
  `GuidanceDoc` table.
- `Document` model (`backend/app/models/documents.py`) with OCR pipeline (M4/M5),
  AES-256-GCM encryption at rest, MinIO storage.
- `Recommendation` (has a `dismissed` flag, `supporting_refs` JSONB) and
  `Notification` (push/email/inapp/bot channels, status state machine) tables —
  `Notification` is currently unused.
- Celery worker infrastructure.

## Architecture

One new module, `backend/app/analyst/memory/`, sits between the data and the
LLM. Ingestion writes to it; both the Ask flow and the alert engine read from it
through a single **Context Assembler**.

```
documents / transactions / loans / recurring
        │
        ▼
   [Ingestion]  ──writes──▶  Memory store (memory_chunk + memory_fact, pgvector)
                                       │
   page context + question ──▶ [Context Assembler] ◀──┘
                                       │  assembles, token-budgeted:
                                       │   structured snapshot (existing)
                                       │ + top-K retrieved chunks (semantic)
                                       │ + relevant active facts
                                       │ + recent conversation turns
                                       │ + structured page scope
                                       ├──▶ Ask (run_ask)              [§3]
                                       └──▶ Insight engine (Celery) ──▶ analyst_alert  [§2]
```

> **Design choice:** a single unified `memory_chunk` table (one pgvector index,
> one retrieval query) rather than per-source embedding columns or an external
> vector DB. Reuses the existing pgvector stack and keeps retrieval a single
> query across all source types.

## Data model

All tables are `household_id`-scoped and accessed via `scoped_query` for tenant
isolation, consistent with the rest of the backend.

### `memory_chunk` — the retrieval index
| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `household_id` | uuid fk | scoped |
| `source_type` | enum | `document` \| `transaction` \| `loan` \| `recurring` \| `note` |
| `source_id` | uuid | points at the originating row |
| `text` | text | the embeddable natural-language representation |
| `embedding` | `Vector(embed_dim)` | |
| `metadata` | JSONB | date, amount, merchant, category, domain, etc. for filtering |
| `created_at` | timestamptz | |

This is how the analyst "sees every transaction" — each is rendered to a short
templated sentence and embedded, so retrieval can pull the relevant handful into
context instead of stuffing all rows into the prompt.

### `memory_fact` — durable learned understanding
| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `household_id` | uuid fk | scoped |
| `domain` | enum | `finance` \| `health` \| `lifestyle` \| `goal` |
| `text` | text | "allergic to peanuts", "freelances, irregular income" |
| `structured` | JSONB | machine-usable form, e.g. `{"allergen":"peanut"}` |
| `confidence` | float | |
| `sensitive` | bool | true for health/PHI-like facts |
| `source_refs` | JSONB | provenance (document/transaction ids) |
| `status` | enum | `active` \| `superseded` |
| `embedding` | `Vector(embed_dim)` | nullable |
| `created_at` / `updated_at` | timestamptz | |

Distinct from chunks: facts are the *understanding* the AI writes and reads, not
raw retrievable text.

### `analyst_alert` — persistent, stateful alerts
| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `household_id` | uuid fk | scoped |
| `kind` | string | `budget_overspend`, `negative_cashflow`, `correlation`, `insight`, … |
| `severity` | int | sort order |
| `signature` | string | stable hash of the condition → drives auto-resolve & upsert |
| `state` | enum | `active` \| `acknowledged` \| `resolved` |
| `title` / `detail` | text | |
| `suggested_action` | JSONB | nullable |
| `supporting_refs` | JSONB | citations (document/transaction/fact ids) |
| `acknowledged_at` / `resolved_at` | timestamptz | nullable |
| `created_at` / `updated_at` | timestamptz | |

Replaces the `localStorage` dismissal entirely. Acknowledge sets state but keeps
the alert visible; when no producer re-emits its `signature`, it auto-resolves.

### `analyst_thread` / `analyst_message` — conversation memory
Server-side replacement for the browser-only thread store, so the analyst
remembers context across turns and sessions.

### `Document` additions
- `domain` (enum, classified at ingestion)
- `private` (bool, opt-out from analyst memory)
- `extracted_text` (text)

## §1 — Ingestion → memory

Extend the existing M4/M5 document pipeline:

1. Any uploaded document → extract text (OCR already covers receipts; add general
   text extraction for statements/reports/PDFs).
2. An **LLM extraction pass** classifies `domain` and pulls structured facts
   (allergies, conditions, income shape, goals) → writes `memory_fact` rows with
   provenance.
3. Chunk the text → embed → write `memory_chunk` rows.
4. The same chunk-and-embed step runs for transactions, loans, and recurring
   series (cheap templated text per row, embedded in batches; incremental on
   create/update).

`private`-flagged documents are skipped at steps 2–3 (opt-out). All embedding
respects the existing at-rest encryption boundary.

## §2 — Insight & alert engine (Celery, scheduled)

A scheduled Celery task runs on new data and daily. Three producers feed one
upsert path:

- **(a) Deterministic rules** — the existing `derive_alerts` logic, ported to
  emit `analyst_alert` rows with stable `signature`s.
- **(b) LLM insight pass** — runs over the assembled context (snapshot + facts +
  notable chunks) to surface non-obvious findings, with citations.
- **(c) Correlation pass** — for each active `health`/`lifestyle` fact, query
  transactions/merchants/categories for matches or conflicts (allergen
  purchased, condition vs spend pattern) and emit `correlation` alerts with
  `supporting_refs`.

Each alert is upserted by `signature`. Acknowledge sets `state=acknowledged`
(still visible). When a run no longer emits a previously-active signature, that
alert is marked `resolved`. Alerts are also written to the `notification` table
for push/email per the existing channel model.

**Frontend:** the monitor feed reads alerts from the API (not localStorage),
shows an *Acknowledge* action (not dismiss), renders acknowledged alerts in a
muted state but keeps them visible until resolved, and shows citations.

## §3 — Ask: context assembler + conversation + page-awareness

`run_ask` becomes thread-aware:

- Accepts a `thread_id`; loads recent turns; persists the new exchange.
- Accepts a **structured page context** `{route, entity, visibleRange, filters}`
  (richer than today's single string), passed from the frontend.
- Calls the **Context Assembler**, which token-budgets and merges: the existing
  structured snapshot + top-K semantically-retrieved `memory_chunk`s for the
  question + relevant active `memory_fact`s + recent turns + the page scope.
- Grounding rules extended: a retrieval miss yields "I don't have that"
  rather than a guess; answers cite `supporting_refs` when memory is used.

## Privacy

- `private` documents never embed and never enter retrieval.
- Health/PHI-like facts are `sensitive`-flagged; surfaced with care and never in
  shared/household-wide contexts beyond the owner's scope.
- Storage encryption (M4 AES-256-GCM) already covers documents at rest.

## Non-goals (this spec)

- No new LLM provider work; reuse the M3 gateway and its `embed()`.
- No re-architecture of the existing analytics/snapshot aggregation — it stays
  and becomes one input to the assembler.
- No multi-household / shared-memory features beyond existing tenant scoping.

## Phasing (waves within this spec)

- **W1 — Memory foundation:** `memory_chunk` + `memory_fact` tables, ingestion
  pipeline (documents + transactions/loans/recurring), Context Assembler wired
  into `run_ask` with citations and the "I don't have that" rule.
- **W2 — Persistent alert engine:** `analyst_alert` table + state machine,
  Celery scheduled producers (deterministic + LLM insight), notification writes,
  frontend acknowledge/auto-resolve UI replacing localStorage dismissal.
- **W3 — Correlation + conversation + deep page context:** correlation pass,
  `analyst_thread`/`analyst_message` server-side conversation memory, structured
  page-context plumbing from frontend through the assembler.

## Success criteria

- The analyst can answer questions grounded in individual transactions and
  uploaded documents, with citations, and admits when it lacks data.
- Uploaded reports of any domain (incl. medical) are searchable memory by
  default, with a working per-document opt-out.
- At least one real cross-domain correlation alert fires from seeded data.
- Alerts persist server-side, can be acknowledged but not hidden, and
  auto-resolve when their condition clears.
- A scheduled background run produces/updates alerts without the app being open.
- The analyst knows the current page/entity and scopes answers accordingly.
- Backend tests and `web` vitest/typecheck stay green.
