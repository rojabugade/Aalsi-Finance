# AI-Powered Cross-Border Personal Finance App — Master Build Specification

> **Purpose of this document.** This is a single, self-contained build brief intended to be handed to an AI app-builder (or an engineering team) to produce the application end-to-end, with no undefined scaffolds. It is both a Product Requirements Document (PRD) and a technical specification. Where a decision is genuinely open, it is flagged in **§16 Open Decisions** rather than left implicit. Read §0 first.

---

## §0 — How to Use This Document (Builder Instructions)

**Role:** You are the lead full-stack engineer + solutions architect building this product from zero.

**Objective:** Produce a single application with two clients — a **mobile app (iOS + Android)** and a **desktop web app** — sharing one backend. Implement features phase by phase per **§13 Roadmap**. Do not stub features silently; if a dependency is missing, surface it as a blocking decision.

**Build philosophy (non-negotiable):**
1. **Privacy- and security-first.** This app holds sensitive financial PII. Security requirements in §10 are hard requirements, not aspirations.
2. **Human-in-the-loop for money.** AI extracts and suggests; the user confirms anything that affects balances, categories at scale, or financial decisions. No silent auto-commit of parsed financial data.
3. **No bank API linking (by design).** No Plaid/Yodlee/account aggregators in scope. Ingestion is document-, OCR-, and assisted-input-based. (Revisit only as a deliberate, separately-scoped decision.)
4. **Informational, not advisory.** The app provides general financial information, education, and compliance *checklists* — never personalized legal, tax, or investment advice. See §12.
5. **Layman UX.** Every screen translates raw financial data into one clear "so what." Complexity is opt-in (drill-downs), never the default surface.
6. **Offline-tolerant mobile.** Capture (photo, manual entry) must work offline and sync later.

**Deliverable for each phase:** working code + tests + migrations + a short README of what shipped and what was deferred.

---

## §1 — Product Vision & Problem Statement

People who live financial lives across two countries (initially **US ↔ India**) lack a single tool that (a) ingests their messy financial reality — receipts, statements, paystubs — without forcing fragile bank integrations, (b) categorizes spending down to the item level, (c) manages debts and income, and (d) gives plain-language guidance on cross-border money movement and its tax/compliance implications.

Mainstream apps (Mint-style aggregators, YNAB, etc.) assume a single jurisdiction and bank-API linking. They break for the NRI / cross-border professional and are intimidating to a "layman." This product fills that gap: **document-driven, AI-assisted, cross-border-aware, and deliberately simple.**

---

## §2 — Target Users / Personas

1. **The Cross-Border Professional (primary).** Earns in USD, supports/invests in India, remits money across borders, must satisfy both US (IRS/FinCEN) and Indian (FEMA/Income Tax) reporting. Technically comfortable but not a finance expert. Wants: clarity on "am I doing this legally and efficiently?"
2. **The Layman Spender (core).** Single-jurisdiction user who just wants to see where money goes, control overspending, and pay off debt. Intimidated by spreadsheets. Wants: "tell me simply what's happening and what to do."
3. **The Debt-Focused User.** Carrying credit-card / personal / education loans (US APR-style and Indian EMI-style). Wants payoff plans, due-date safety, and penalty avoidance.

Design for #2 as the default experience; layer #1 and #3 capabilities on top without cluttering the base.

---

## §3 — Goals, Non-Goals, Guiding Principles

**Goals**
- Effortless, multi-modal capture of financial data (photo, file upload, manual, conversational bot).
- Accurate extraction and item-level categorization with user confirmation.
- Actionable, plain-language analytics and recommendations.
- Debt and income management with safety nets (reminders, penalty warnings).
- Cross-border (US-India) informational guidance + compliance checklists.
- One coherent product across mobile and desktop web.

**Non-Goals (explicitly out of scope unless re-scoped)**
- Bank account aggregation / open-banking linking.
- Executing payments, trades, or money transfers. The app never moves money.
- Personalized regulated advice (investment, tax, legal). It informs and points to professionals.
- Being a system of record for tax filing. It assists preparation; it does not file.

**Guiding Principles**
- *Capture first, classify later.* Never block the user at capture time.
- *Confidence-scored AI.* Every AI extraction/categorization carries a confidence score; low confidence routes to review.
- *Explainable.* Every recommendation states the data it's based on.
- *Reversible.* Categorizations, merges, and rules can be undone; an audit trail exists.

---

## §4 — Scope Overview & MVP Definition

**MVP (Phase 1) =** Capture → OCR/extract → confirm → categorize (basic) → see it on a dashboard with time filters, in two currencies, on mobile + web, behind secure auth. Everything else (item-level analytics, AI recommendations, debt, salary, cross-border, bot, SMS/email ingestion) layers on in later phases (§13). The MVP must be genuinely usable on its own.

---

## §5 — Functional Requirements (Detailed)

### 5.1 Ingestion & OCR

**Supported inputs (MVP):**
- Photo capture (mobile camera) of receipts/invoices.
- File upload (mobile + web): images (JPG/PNG/HEIC), PDF (bank statements, e-statements, invoices, paystubs), CSV.
- Manual entry (always available, offline-capable).

**Later inputs (phased):** conversational bot (§5.9), email forwarding / OAuth ingestion (§11), Android SMS (policy-dependent, §11).

**Pipeline (async, job-queued):**
1. **Upload & store** raw document to object storage (encrypted; signed-URL access only). Record a `Document` row with `status = uploaded`.
2. **Preprocess** (deskew, denoise, orientation, multi-page split for PDFs).
3. **OCR / structured extraction** — choose per document type:
   - **Receipts/invoices:** expense-aware extractor (e.g., AWS Textract `AnalyzeExpense`, Google Document AI Invoice/Receipt parser, or Azure Document Intelligence). Extracts merchant, date, totals, tax, **and line items**.
   - **Bank statements (PDF):** table/forms extraction (Textract tables, Document AI bank-statement parser) → list of transactions (date, description, amount, balance). **Note:** bank statements give *transaction-level* data only — no line items.
   - **Paystubs:** form extraction → gross, deductions, taxes, net, employer, pay period.
   - **CSV:** schema-mapping wizard (user maps columns once per source; remembered).
4. **LLM normalization layer.** Feed raw extraction → LLM (via orchestration layer) → normalized JSON: merchant (canonicalized), ISO date, signed amount, currency, candidate category, tax, line items. Output is **strictly schema-validated** (reject/repair on parse failure). Attach a **confidence score** per field.
5. **Reconciliation (key behavior).** Match receipt-derived purchases to statement-derived transactions (by amount + date + merchant fuzzy match) to avoid double-counting and to enrich a transaction with its line items. Unmatched items remain standalone; user can manually link.
6. **Review queue.** Low-confidence extractions and ambiguous reconciliations surface in a "Needs review" inbox. User confirms/edits → commit.
7. **Persist** as `Transaction` (+ `LineItem` children where available). Update `Document.status = processed`.

**Acceptance:** Upload a real grocery receipt → within the async window, a confirmed transaction with itemized line items appears, correctly categorized at ≥ a target confidence, with the original document retrievable.

### 5.2 Transactions & Line Items (data-model nuance — read carefully)

The product's headline "categorize down to individual items" is **only possible from itemized sources (receipts/invoices)**. Bank/credit statements yield a single aggregate charge per merchant (e.g., one "MACY'S $214.30" line). Therefore:

- `Transaction` = a money movement (from statement *or* a receipt total). Has merchant, amount, currency, date, account, category.
- `LineItem` = an individual purchased item *within* a transaction (from a receipt). Has name, item-type/sub-category, amount, quantity (optional). 
- The **Macy's example** ("3 pants, 3 tops, 4 cosmetics; show total Macy's spend and per-product-type contribution") is satisfied by: itemized receipt → LineItems tagged with product-type → faceted rollup. If only the statement exists, the app shows the **aggregate** and prompts the user to attach the receipt to unlock the breakdown. **This expectation must be set in the UX.**

**Transaction features:** edit/split/merge, recurring detection, refunds/credits, multi-currency with FX snapshot at transaction date, attachments (source document), notes, manual flagging (e.g., "business," "reimbursable").

### 5.3 Categorization, Tagging & "Pseudo-Categories"

- **Hierarchy:** Category → Sub-category → Item-type, plus free-form **Tags** and **Merchant** as a first-class dimension.
- **Categorization engine (hybrid):**
  1. **Deterministic rules first** (user- and system-defined: "merchant = Trader Joe's → Groceries"). Fast, free, predictable.
  2. **LLM/embedding fallback** for unknown merchants/items (semantic classification against the taxonomy, with confidence).
  3. **Feedback loop:** every user correction creates/updates a rule and improves future classification (store as a `RuleSet`; optionally fine-tune/few-shot from corrections later).
- **Pseudo-categories / dynamic grouping (the "auto pseudo-category for tagged/grouped items" requirement):** a flexible **faceted aggregation** layer. Any combination of {merchant, category, sub-category, item-type, tag, time-window} produces a rollup with totals and contribution breakdowns. Example outputs:
  - "Macy's, this quarter: **$214.30 total** — Pants $90, Tops $74, Cosmetics $50.30." (quantities optional, amount-weighted).
  - "All Groceries across all merchants, monthly trend."
  - "Everything tagged `business`, year-to-date, by merchant."
- **Editable taxonomy:** users add/rename categories; merges re-tag historical data.

### 5.4 Analytics, Filtering & Time-Series

- **Dynamic time filtering:** preset (this month / quarter / year / last N) **and** arbitrary custom ranges; comparison mode (period-over-period).
- **Views:** dashboard (top-line: spend, income, net, by top categories), category drill-down, merchant view, trend charts, breakdown ("where did the Macy's number come from").
- **Performance:** pre-aggregate via materialized views / rollup tables or an OLAP-friendly query path so faceted, multi-dimension, multi-period queries stay fast as data grows (§10 Performance).
- **Budgets (Phase 2+):** per-category budgets, progress, overspend alerts.

### 5.5 AI-Powered Analysis & Recommendations

- **Context-aware, per-category recommendations** grounded in the user's actual data, e.g.: "Dining is up 40% vs. your 3-month average, driven by 6 DoorDash orders." Each recommendation **cites the underlying transactions/figures** (explainability requirement).
- **Anomaly/spike detection;** recurring-charge surfacing (e.g., forgotten subscriptions); duplicate-charge flagging.
- **Guardrails:** recommendations are framed as observations and general tips, **not** as personalized financial advice (§12). No "buy X / sell Y" outputs. Keep a clear line between "here's what your data shows" and "here's what you should do with your money."
- **Cost control:** route routine classification to rules/cheap models; reserve larger LLM calls for genuine reasoning; cache aggressively.

### 5.6 Debt & Loan Management

- **Debt accounts:** credit cards (US, revolving, APR + min payment), personal/auto/education loans (US), **EMI-based loans (India)**. Fields: principal, interest rate, compounding, schedule, due dates, minimum/EMI amount, penalties/late-fee rules.
- **Payment schedules & amortization:** generate full schedule; track paid/upcoming; remaining balance.
- **Due-date & penalty safety net:** reminders ahead of due dates; **penalty/late-fee warnings**; "if you pay only the minimum, here's the interest cost / payoff horizon."
- **Payoff calculators:** "estimated time to payoff" under different monthly payments; **snowball vs. avalanche** strategy comparison; effect of one-off extra payments.
- **Multi-currency debts** (e.g., an INR loan while earning USD) with FX context.

### 5.7 Salary & Income Management

- **Income sources:** multiple sources, pay frequency, gross vs. net, currency.
- **Paystub OCR** → auto-populate gross, deductions, taxes, net.
- **Withholding/take-home modeling (informational):**
  - US: federal + state + FICA estimation.
  - India: TDS, **old vs. new tax regime** comparison (illustrative).
- **Cross-border income view:** earnings in USD, planned/actual remittance to India, take-home after estimated taxes both sides. (Estimates only; §12 disclaimer applies.)
- **Income vs. spend vs. savings** rollup feeding the dashboard.
- *("More depth" placeholder from the brief is resolved into: source management, paystub ingestion, withholding estimation, regime comparison, and remittance linkage. Further depth — e.g., bonus/RSU/ESPP handling, variable income smoothing — is listed in §16 Open Decisions.)*

### 5.8 Cross-Border (US ↔ India) Module — the Differentiator

**Capabilities:**
- **Remittance tracker:** log transfers US→India / India→US with purpose, amount, FX rate, channel; running totals against relevant annual limits.
- **Compliance checklist & guidance engine (informational):** surfaces the rules and forms relevant to the user's situation and reminds them of obligations. Topics the knowledge base must cover (figures/rates **must be kept current via the RAG knowledge base and verified with a professional — do not hardcode as advice**):
  - **India outbound:** Liberalised Remittance Scheme (LRS) annual cap; TCS on foreign remittances; Form 15CA/15CB requirements; FEMA basics; NRE vs. NRO account treatment.
  - **US reporting:** FBAR (FinCEN Form 114) aggregate-foreign-account threshold; FATCA (Form 8938) thresholds; treatment of foreign income.
  - **Both:** DTAA (Double Taxation Avoidance Agreement) concept and foreign tax credit; Schedule FA (foreign assets) in the Indian return; residency-status implications (US resident vs. NRI status, days-of-presence).
- **"What applies to me" wizard:** asks minimal questions (residency, amounts, account types) → produces a personalized **checklist + reminders + links to authoritative sources**, each with a "consult a CA / CPA / tax professional" CTA.
- **Investment *education* module (NOT advice):** explains instrument *types* available to NRIs / in the Indian and US markets (e.g., what NRE/NRO FDs, mutual funds, equities, retirement accounts are), how they're generally taxed, and **general considerations** — strictly educational, no personalized recommendations, no "buy this fund." See §12 for the hard constraint and licensing note.

**Architecture for guidance:** a **RAG knowledge base** over a **curated, versioned, citable corpus** of regulatory content (maintained by the team, with effective dates), so answers cite sources and can be updated as laws change — never free-form hallucinated tax claims. Every cross-border answer carries the §12 disclaimer.

### 5.9 Conversational Bot (Telegram / Discord)

- **Use cases:** (a) log an expense by sending a receipt photo (→ OCR pipeline), (b) log by natural language ("spent ₹1,200 on groceries at DMart") → LLM parse → transaction draft, (c) query ("how much did I spend on dining this month?"), (d) get reminders pushed.
- **Architecture:** bot is a **thin client to the same backend API**, not a separate brain. Webhook-driven; account linking via one-time code / deep link mapping the Telegram/Discord user ID → app account; per-link auth token.
- **Confirmation:** parsed expenses are drafts requiring a quick confirm (inline button), preserving human-in-the-loop.
- **Privacy warning (must implement, must surface to user):** financial data flowing through third-party chat platforms is a real privacy exposure. Require **explicit opt-in**, minimize sensitive data in messages, never echo full account numbers, and document this in the privacy policy. Feasibility detail in §11.

### 5.10 Notifications & Reminders

- Bill/EMI/loan due-date reminders; penalty warnings; budget overspend; "needs review" queue nudges; cross-border obligation reminders (e.g., remittance-limit proximity, filing-season prompts).
- Channels: push (mobile), email, in-app, and bot. User-configurable.

### 5.11 Settings, Accounts & Multi-Currency

- **Logical accounts** (user-defined buckets like "HDFC Savings," "Chase Sapphire") — labels only, **never linked to real bank APIs or storing bank credentials.**
- **Multi-currency:** base currency (USD or INR) per user; per-transaction currency; FX rates from a provider with daily refresh; historical FX snapshots stored on each transaction for accurate reporting.
- **i18n / language:** English + **Hindi / Hinglish** (UI strings + NL bot parsing). Locale-aware dates/numbers.
- **Data controls:** export (CSV/PDF), full delete, consent management per ingestion channel.

---

## §6 — AI / ML System Design

| Concern | Approach |
|---|---|
| Document OCR | Managed expense/forms OCR (Textract / Document AI / Azure DI) for accuracy; open-source fallback (PaddleOCR / docTR / Tesseract) for cost or on-prem. |
| Extraction normalization | LLM with **strict schema-constrained output** (JSON schema validation + repair); per-field confidence. |
| Categorization | Hybrid: deterministic rules → embedding/LLM classification fallback → feedback-driven rule learning. |
| NL expense parsing (bot) | LLM intent+entity extraction → structured draft transaction. |
| Recommendations | Retrieval over the user's own aggregated data + LLM summarization, **with citations**; guardrailed against personalized financial advice. |
| Cross-border guidance | **RAG** over a curated, versioned, citable regulatory corpus; answers must cite sources + carry disclaimers. |
| Guardrails | System prompts + output filters that block personalized investment/tax/legal advice and block "move money" instructions; PII redaction in any third-party calls where feasible. |
| Cost & latency | Rules-first, cache embeddings/classifications, batch async OCR, cheap models for routine paths, larger models only for reasoning. |
| Evaluation | Golden-set tests for OCR accuracy, categorization precision/recall, and parse validity; track confidence calibration; regression tests on the regulatory corpus answers. |

**Orchestration:** an LLM orchestration layer (e.g., LangChain or equivalent) coordinates OCR post-processing, RAG, NL parsing, and recommendations. Keep prompts/versioned and testable.

---

## §7 — Data Model (Core Entities)

Relational store (Postgres recommended). Key entities and notable fields:

- **User** — id, auth refs, base_currency, locale/language, residency_profile (for cross-border wizard), consent flags, MFA settings.
- **Account (logical)** — id, user_id, label, type (checking/credit/cash/loan/etc.), currency. *No bank credentials, ever.*
- **Document** — id, user_id, storage_key (encrypted), type (receipt/statement/paystub/csv), status (uploaded→processing→needs_review→processed→failed), source_channel, ocr_metadata, created_at.
- **Transaction** — id, user_id, account_id, merchant_id, amount, currency, fx_rate_snapshot, date, category_id, status (draft/confirmed), source_document_id, flags (business/reimbursable/recurring), notes, confidence.
- **LineItem** — id, transaction_id, name, item_type/sub_category_id, amount, quantity (nullable), confidence.
- **Merchant** — id, canonical_name, aliases, default_category_id, logo (optional).
- **Category / SubCategory** — id, parent_id, name, is_system, user_id (nullable for system).
- **Tag** — id, user_id, name; **TransactionTag / LineItemTag** join tables.
- **RuleSet** — id, user_id, matcher (merchant/keyword/amount pattern), action (assign category/tag), source (user/system), priority.
- **Budget** — id, user_id, category_id, period, amount.
- **DebtAccount / Loan** — id, user_id, type, principal, interest_rate, compounding, currency, min_or_emi_amount, due_day, penalty_rules, start/end dates.
- **PaymentSchedule** — id, loan_id, installment_no, due_date, principal_component, interest_component, balance_after, status (due/paid/late).
- **IncomeSource / Salary** — id, user_id, employer, currency, frequency, gross, net, withholding_estimates.
- **Paystub** — id, income_source_id, source_document_id, period, gross, deductions(json), net.
- **FXRate** — currency_pair, date, rate.
- **CrossBorderTransfer** — id, user_id, direction, amount, currency, fx_rate, purpose, channel, date; running totals computed against limits.
- **Recommendation** — id, user_id, type, payload, supporting_refs (transaction ids), generated_at, dismissed.
- **Notification** — id, user_id, type, channel, payload, scheduled_for, status.
- **BotLink** — id, user_id, platform (telegram/discord), platform_user_id, auth_token, linked_at, consent_flags.
- **AuditLog** — id, user_id, actor, action, entity, before/after, timestamp.
- **ConsentRecord** — id, user_id, channel (sms/email/bot/etc.), granted, granted_at, revoked_at, policy_version.

(Relationships: User 1—* everything; Transaction 1—* LineItem; Loan 1—* PaymentSchedule; Merchant 1—* Transaction; Category self-referential hierarchy.)

---

## §8 — System Architecture

**Clients**
- **Mobile (iOS + Android):** single cross-platform codebase. **Recommended:** React Native (shares TypeScript business logic with the web client) *or* Flutter. (Decision in §16.) Native needs: camera capture, secure storage (Keychain/Keystore), biometric unlock, push, offline cache + sync.
- **Desktop web:** React (Next.js) sharing types/business logic with mobile where the stack allows. Full upload, review, analytics, and management surfaces.
- **PWA consideration:** a PWA can cover web + installable mobile and handles camera/upload fine (it cannot do SMS anyway — see §11), but it limits native polish (biometrics, push reliability, offline robustness). Recommendation: native mobile + web for the best experience; PWA is a viable cost-saving alternative if mobile-native effort must be deferred.

**Backend** — Python / FastAPI (async). Modular monolith to start, with clear service boundaries so it can split later:
- **Auth service** — OAuth2/OIDC, MFA, sessions/refresh tokens, RBAC.
- **Ingestion/OCR service** — upload handling, job orchestration, OCR provider adapters, normalization, reconciliation.
- **Transactions service** — CRUD, split/merge, recurring detection.
- **Categorization (AI) service** — rules engine + LLM/embedding classifier + feedback learning.
- **Analytics/Reporting service** — faceted aggregation, time-series, rollups, exports.
- **Debt service** — amortization, schedules, payoff calculators.
- **Income service** — salary, paystub, withholding estimation.
- **Cross-border service** — RAG over regulatory corpus, compliance wizard, remittance tracking.
- **Notifications service** — scheduling + multi-channel dispatch.
- **Bot gateway** — Telegram/Discord webhooks → backend API.

**Async & messaging** — a job queue / event backbone (Celery/RQ for simplicity, or Kafka if event-driven scale is wanted) for OCR jobs, AI tasks, FX refresh, and scheduled notifications. Retries + dead-letter handling.

**Storage**
- **Postgres** — primary relational store (consider `pgvector` to co-locate embeddings, or a dedicated vector DB).
- **Object storage (S3/GCS)** — encrypted documents, signed-URL access, lifecycle policies.
- **Redis** — cache, sessions, rate limiting, queue broker (if used).
- **Vector DB** (Qdrant or pgvector) — RAG corpus + merchant/category/item embeddings.

**External integrations** — OCR provider, LLM provider(s), FX rate API, Telegram Bot API, Discord bot, (optional) email OAuth (Gmail/Microsoft Graph), push (FCM/APNs).

**Infra** — Docker; orchestration (Kubernetes or managed equivalent); IaC; multi-env (dev/staging/prod); CI/CD with automated tests and migrations; secrets in a managed vault/KMS.

**Data flow (capture path), described:**
`Client capture → upload to object storage + Document row → enqueue OCR job → OCR provider → LLM normalization (schema-validated, confidence-scored) → reconciliation against existing transactions → if confident: draft committed / if not: Needs-Review queue → user confirm → Transaction(+LineItems) persisted → analytics rollups updated → dashboards/notifications reflect it.`

---

## §9 — API Design (Overview)

REST (or GraphQL if a single flexible query surface is preferred for the faceted analytics). Representative resources:

- `POST /documents` (upload) · `GET /documents/{id}` (status) · `GET /documents/{id}/file` (signed URL)
- `GET/POST/PATCH /transactions` · `POST /transactions/{id}/split` · `POST /transactions/merge` · `POST /transactions/{id}/line-items`
- `GET /analytics/summary?from&to&group_by[]=merchant,category,tag` (faceted, multi-dimension, period-comparison)
- `GET/POST /categories` · `GET/POST /tags` · `GET/POST /rules`
- `GET/POST /loans` · `GET /loans/{id}/schedule` · `POST /loans/{id}/payoff-calc`
- `GET/POST /income-sources` · `POST /paystubs`
- `POST /cross-border/wizard` · `GET /cross-border/checklist` · `POST /cross-border/transfers` · `POST /cross-border/ask` (RAG, cited)
- `POST /bot/link` · `POST /webhooks/telegram` · `POST /webhooks/discord`
- `GET/POST /notifications` · `GET /export`
- `POST /auth/*` (login, mfa, refresh)

Each money-affecting or AI-suggested write returns a **draft/needs-confirmation** state where §0 principle 2 applies.

---

## §10 — Non-Functional Requirements

**Security (hard requirements — financial PII)**
- Encryption in transit (TLS 1.2+/1.3) and at rest (AES-256). Field-level encryption for the most sensitive fields.
- **Never store real bank credentials or full account/card numbers.** Mask everywhere; logical accounts are labels only.
- Secrets in managed KMS/vault; no secrets in code or logs. No financial PII in application logs.
- AuthN: OAuth2/OIDC; **MFA**; biometric unlock on mobile; secure session + rotating refresh tokens.
- AuthZ: strict per-user data isolation (every query scoped to the owner); RBAC; tenant checks enforced server-side.
- Document access via short-lived signed URLs only.
- Audit logging of sensitive actions; tamper-evident.
- Security testing: dependency scanning, SAST, periodic pen testing; aim toward SOC 2-style controls.

**Privacy & Compliance (data protection)**
- Explicit, per-channel consent (especially SMS/email/bot). Consent records versioned (`ConsentRecord`).
- Data minimization; clear retention + deletion policy; user-initiated export and full delete (DSAR-style).
- Applicable regimes to design for: **India DPDP Act 2023**, US state privacy laws (e.g., CCPA/CPRA and successors), GDPR if EU users. **Data residency:** decide where Indian users' data is stored (DPDP and any RBI considerations if payment-adjacent) — flagged in §16.
- A real privacy policy describing every ingestion channel and third-party processor (OCR, LLM, FX, chat platforms).

**Performance & Scale**
- Async OCR/AI off the request path; capture is instant.
- Faceted analytics fast at scale via rollup/materialized views or OLAP path; paginate; cache hot aggregates.
- Mobile **offline-first capture + background sync**; conflict resolution on sync.
- Define target p95 latencies for interactive endpoints and an SLA for OCR turnaround.

**Internationalization / Localization**
- Full i18n; **English + Hindi/Hinglish**; locale-aware formatting; multi-currency with historical FX.

**Accessibility**
- WCAG 2.1 AA: screen-reader support, scalable text, sufficient contrast (critical for dense financial figures), keyboard navigation on web.

**Reliability & Observability**
- Structured logging, metrics, distributed tracing, error tracking; alerting on OCR failures, queue backlogs, auth anomalies.
- Idempotent job processing; retries + dead-letter queues; graceful degradation (e.g., OCR provider outage → queue and retry, never lose the upload).
- Backups + tested restore; defined RPO/RTO.

---

## §11 — Technical Feasibility Assessment (Edge Ingestion & Bot)

This section answers the brief's explicit feasibility questions. **Bottom line: automatic SMS/email/app scraping is heavily constrained; treat it as optional, platform-specific, best-effort enrichment — never as core ingestion. The robust cross-platform path is assisted capture (photo, upload, share sheet, bot, email forwarding, statement upload).**

### 11.1 Auto-extracting transactions from SMS

- **iOS — effectively impossible for third-party apps.** iOS does not expose SMS/iMessage content to third-party apps. There is no API to read the user's messages. The only adjacent capabilities are (a) system-level **OTP autofill** (you never see arbitrary content) and (b) the **SMS filter extension** (`ILMessageFilterExtension`) which only sees messages from *unknown senders* for spam classification, runs sandboxed, and **cannot freely exfiltrate content to your server**. Conclusion: no automatic bank-SMS scraping on iOS. *Workaround:* user manually **shares** an SMS (Share Sheet) or a screenshot into the app; or forwards.
- **Android — possible but policy-risky and brittle.** `READ_SMS`/`RECEIVE_SMS` exist, but **Google Play restricts SMS/Call-Log permissions** to apps whose core function genuinely requires them (historically the default SMS handler, with a narrow set of declared exceptions). "Finance app reading bank SMS" has been a moving target in Play policy; apps have been removed for it, and use requires a **Permissions Declaration** and review. Even when permitted, parsing bank SMS is **brittle** (formats vary by bank/sender and change without notice) and maintenance-heavy. **Action:** *verify the current Google Play SMS/Call-Log policy before committing*; if pursued, build a robust, per-sender parser library with graceful failure, and gate behind explicit user consent. Treat as Android-only, optional.

### 11.2 Auto-extracting from email

- **Feasible and policy-compliant via OAuth, but with a verification cost.** Read-only access to transaction emails / e-statements via **Gmail API** or **Microsoft Graph** is technically clean. However, Gmail's `gmail.readonly` is a **restricted scope** requiring Google's OAuth app verification + an annual third-party **security assessment (CASA)** — non-trivial time and money. Microsoft Graph has its own consent/verification path.
- **Lower-friction alternatives:** (a) user **forwards** transaction emails / statements to an app-owned ingestion address (parsed by the same pipeline); (b) user uploads the e-statement PDF directly. These avoid restricted-scope verification entirely and are the recommended Phase-1/2 approach. Pursue full OAuth email ingestion only if the user base justifies the verification cost (§16).

### 11.3 Reading data from other apps

- **No general capability.** Both platforms sandbox apps; you cannot read another app's data. On Android, the only adjacent hooks are **NotificationListenerService** (read notifications, e.g., payment-app alerts) and **Accessibility Services** — both are **heavily restricted by Google Play**, frequently rejected, and ethically/privacy-sensitive; not recommended as a primary mechanism. iOS has no equivalent. Conclusion: do not design core ingestion around cross-app reading.

### 11.4 Telegram / Discord bot

- **Fully feasible and recommended (it sidesteps the SMS/email constraints entirely).** Both platforms provide first-class bot APIs.
  - **Telegram:** Bot API (webhook), inline keyboards for confirmations, can receive photos (→ OCR) and text (→ NL parse). Straightforward.
  - **Discord:** bot via the official API/gateway (e.g., `discord.py` or equivalent), slash commands, attachments, buttons.
- **Pattern:** bot = thin client → backend API; account-link via one-time code/deep link; per-user token; drafts require confirmation (preserves human-in-the-loop).
- **Constraints to respect:** rate limits + webhook setup per platform; **privacy** — financial data transits a third party, so require explicit opt-in, minimize sensitive content in messages, never echo full account numbers, and disclose the processor in the privacy policy. Bot Terms of Service of each platform apply.

**Feasibility verdict & recommended ingestion strategy:**
1. **Core (all platforms):** photo capture, file/PDF/CSV upload, manual entry, **bot** (Telegram/Discord). Robust, compliant, cross-platform.
2. **Assisted (all platforms):** Share Sheet / forward-to-email-address.
3. **Optional, platform-specific, verify-first:** Gmail/Graph OAuth ingestion (verification cost); **Android-only** SMS parsing (policy-dependent, brittle).
4. **Not recommended:** cross-app reading, notification/accessibility scraping as primary mechanisms.

---

## §12 — Compliance, Legal & Advisory Boundaries (must be implemented, not just documented)

This product handles money topics and cross-border tax/investment matters. To stay safe and trustworthy:

- **Not financial/tax/legal advice.** The app provides **general information, education, and compliance checklists only.** Every recommendation, withholding estimate, cross-border answer, and investment-education screen must carry a clear, persistent disclaimer and a "consult a licensed professional (CPA / CA / financial advisor / attorney)" CTA. Estimates are illustrative, not authoritative.
- **No personalized investment advice without licensing.** Personalized "buy/sell/allocate" guidance is a **regulated activity** (e.g., **SEBI Registered Investment Adviser** in India; **SEC/state RIA** in the US). Unless the operating entity holds the relevant license, the investment module must remain **strictly educational** (explaining instrument types and general taxation) and must **not** output personalized recommendations. This is a hard product constraint enforced by the AI guardrails (§6).
- **The app never moves money or executes trades/transfers.** It tracks and informs only.
- **Regulatory content must be sourced and dated.** Cross-border guidance comes from the curated, versioned RAG corpus with citations and effective dates — never free-form generated tax claims. Build a process to keep it current (rates/limits/thresholds change frequently).
- **Data protection compliance** per §10 (DPDP Act, US state laws, GDPR if applicable), with real consent and deletion flows.
- **Get professional review.** Before launch, have the disclaimers, the cross-border content approach, and the licensing posture reviewed by qualified legal/tax counsel in both jurisdictions. (Builder should flag this as a launch gate, not assume it away.)

---

## §13 — Phased Delivery Roadmap

Each phase ships independently usable value, with tests + migrations + a "what shipped / what deferred" README.

**Phase 0 — Foundations**
- Auth (OAuth2/OIDC, MFA, biometric on mobile), per-user data isolation, audit logging.
- Core data model + migrations; logical accounts; multi-currency scaffolding + FX ingestion.
- Document upload + secure encrypted object storage; manual transaction entry (offline-capable on mobile); base category taxonomy.
- App shells: mobile (iOS+Android) + desktop web, sharing types/business logic; CI/CD; observability baseline.
- *Acceptance:* a user can sign up securely, manually log multi-currency transactions on web and mobile (offline then sync), and upload a document that is stored encrypted.

**Phase 1 — MVP (Capture → Confirm → See)**
- Async OCR pipeline for **receipts** and **bank statements**; LLM normalization with confidence; reconciliation; **Needs-Review** queue.
- Hybrid categorization (rules + LLM fallback) with user-correction feedback loop.
- Dashboard + **dynamic time-series filtering** (presets + custom range + comparison); category & merchant views.
- *Acceptance:* upload a real receipt and a real statement → confirmed transactions (line items where itemized) appear, correctly categorized at target confidence, on dashboards with working time filters, in two currencies, on mobile + web.

**Phase 2 — Deep Categorization, Analytics & Recommendations**
- **Item-level categorization** + **faceted pseudo-category rollups** (the Macy's breakdown); editable taxonomy with historical re-tagging; tags.
- Pre-aggregation for fast faceted/period queries; budgets + overspend alerts.
- **AI recommendations** (per-category, cited, guardrailed); anomaly/recurring/duplicate detection.
- *Acceptance:* "Macy's this quarter = total + per-product-type contribution" works from itemized receipts; recommendations cite the data; budgets alert correctly.

**Phase 3 — Debt & Income**
- Debt/loan management: US revolving + loan types and **India EMI**; amortization schedules; due-date reminders + **penalty warnings**; **payoff calculators** (snowball/avalanche, extra-payment scenarios).
- Salary/income: sources, **paystub OCR**, withholding estimates (US fed/state/FICA; India TDS + old/new regime comparison); income-vs-spend-vs-savings rollup.
- *Acceptance:* add a loan → schedule + reminders + "time to payoff under X payment"; upload a paystub → populated income + take-home estimate (with disclaimer).

**Phase 4 — Cross-Border (US-India) Module**
- Curated, versioned **regulatory RAG corpus**; "what applies to me" wizard → personalized checklist + reminders + cited links; remittance tracker with limit-proximity alerts; **investment-education** module (educational only).
- All outputs carry §12 disclaimers; legal/tax review gate before exposing publicly.
- *Acceptance:* wizard produces a correct, source-cited checklist for a sample profile; remittance tracker warns near limits; no personalized advice is ever emitted (verified by guardrail tests).

**Phase 5 — Conversational Bot & Optional Ingestion**
- Telegram + Discord bot: photo logging, NL expense logging (with confirm), queries, reminder push; explicit opt-in + privacy safeguards.
- *Optional, verify-first:* email OAuth ingestion (if justified) and/or **Android-only** SMS parsing (policy-permitting); Share-Sheet/forward-to-email assisted capture.
- *Acceptance:* link the bot via one-time code → photo and "spent ₹X at Y" both create confirmed transactions; queries return correct figures; no full account numbers ever echoed.

**Phase 6 — Polish & Scale**
- Robust offline sync + conflict resolution; advanced budgeting; household/multi-user (if scoped); richer exports; performance hardening; accessibility pass; security/pen-test pass.

---

## §14 — Definition of Done / Quality Gates (every phase)

- Unit + integration + key end-to-end tests; AI components covered by golden-set evals (OCR accuracy, categorization precision/recall, parse validity, guardrail/no-advice tests, RAG citation correctness).
- Migrations reversible; seed/fixture data for local runs.
- Security checks: per-user isolation verified, no secrets/PII in logs, dependency scan clean.
- Accessibility + i18n smoke checks (English + Hindi/Hinglish strings present).
- Observability: new paths emit logs/metrics/traces; failure modes handled (retries/DLQ).
- README per phase: shipped, deferred, known limitations, decisions taken.

---

## §15 — Risks & Mitigations

| Risk | Mitigation |
|---|---|
| OCR accuracy on messy receipts/statements | Managed expense OCR + LLM normalization + confidence routing + human review; golden-set evals; per-source CSV mapping. |
| Item-level expectation can't be met from statements | Set UX expectation; unlock breakdown only via attached receipts; reconcile to avoid double-counting. |
| SMS/email scraping blocked or policy-rejected | Treat as optional; lead with bot + upload + share/forward; verify platform policy before building. |
| Stale or wrong cross-border tax info | Curated, dated, cited RAG corpus + update process + disclaimers + professional review; never hardcode rates as advice. |
| Regulated-advice / licensing exposure | Hard guardrails: educational only, no personalized investment advice unless licensed; legal review gate. |
| Financial-data breach | Encryption, no stored credentials, masking, MFA, least-privilege, audit, pen-testing. |
| Third-party chat privacy (bot) | Explicit opt-in, data minimization, no full account numbers, disclosure in policy. |
| Analytics slow at scale | Rollups/materialized views/OLAP path + caching + pagination. |
| Gmail restricted-scope cost/time | Default to forward-to-address / PDF upload; pursue OAuth only if ROI justifies. |
| LLM cost runaway | Rules-first, caching, cheap models for routine paths, batching. |

---

## §16 — Open Decisions (resolve with the product owner before/within the relevant phase)

1. **Mobile stack:** React Native (max code-share with web) vs. Flutter vs. PWA-first. (Affects native feature depth and effort.)
2. **OCR provider:** Textract vs. Google Document AI vs. Azure Document Intelligence vs. open-source — by accuracy, cost, and data-residency.
3. **Build vs. buy AI:** cloud LLM API vs. self-hosted; which provider(s).
4. **Vector store:** pgvector (simpler) vs. dedicated (Qdrant).
5. **Queue/event tech:** Celery/RQ (simple) vs. Kafka (event-scale).
6. **Data residency:** where Indian users' data lives (DPDP / any RBI considerations) and US data handling.
7. **Email OAuth ingestion:** pursue restricted-scope verification (cost) or stick to forward/upload?
8. **Android SMS parsing:** pursue at all, given Play policy volatility?
9. **Licensing posture:** will the entity ever hold SEBI/SEC RIA registration? If not, investment module stays strictly educational (assumed default).
10. **Single-user vs. household/multi-user** scope.
11. **Monetization** (affects limits, tiers, data handling) — out of engineering scope but shapes requirements.
12. **Income depth:** RSU/ESPP/bonus/variable-income handling — in scope or later?
13. **Primary jurisdiction of operation / company entity** (drives which compliance regime is authoritative).

---

## §17 — Glossary (US-India finance terms used above)

- **LRS** — Liberalised Remittance Scheme (India's annual cap on outbound individual remittance).
- **TCS** — Tax Collected at Source (applies to certain foreign remittances from India).
- **FEMA** — Foreign Exchange Management Act (India).
- **NRE / NRO** — Non-Resident External / Non-Resident Ordinary accounts (India) with different tax/repatriation treatment.
- **Form 15CA/15CB** — declarations/certificates for certain foreign remittances (India).
- **DTAA** — Double Taxation Avoidance Agreement (relief from being taxed twice; foreign tax credit).
- **Schedule FA** — Foreign Assets schedule in the Indian income-tax return.
- **FBAR** — Report of Foreign Bank and Financial Accounts (FinCEN Form 114, US).
- **FATCA** — Foreign Account Tax Compliance Act; Form 8938 (US).
- **EMI** — Equated Monthly Installment (India loan repayment model).
- **DPDP Act** — Digital Personal Data Protection Act, 2023 (India).
- **RIA** — Registered Investment Adviser (SEBI in India / SEC or state in US).

*(All figures, thresholds, rates, and rules referenced are illustrative of what the knowledge base must cover; they must be kept current and verified with qualified professionals. This document is a build specification, not financial, tax, or legal advice.)*
