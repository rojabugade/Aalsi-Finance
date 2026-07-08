# Slice G — AI Analyst Pane

Status: approved design (2026-06-20)
Source vision: `mockup images/widgets.md` §8 (AI Analyst Pane), §1.3 (Intelligence Layer)
Roadmap: `docs/superpowers/specs/2026-06-19-dashboard-widgets-roadmap.md` (slice G)

## Goal

Ship the AI Analyst as a **floating pane opened by an always-present "blob" (FAB) in the
bottom-right corner** of the dashboard. The analyst works over the household's *own*
financial data and exposes four real, working modes: **Monitor, Explain, Plan, Action**.

This slice also removes the now-superseded toolbar Analyst toggle (the only other
control that opened an analyst surface). The toolbar Ask-AI search bar is left as-is
(wired in a later slice).

### Non-goals (this slice)

- Tone / personality presets (§8 "AI Analyst Personality Options") — deferred, flagged.
- Wiring the toolbar Ask-AI bar into the pane — deferred.
- A "hide the blob entirely / fully removable" setting — blob is always present.
- Streaming token-by-token responses — single-shot request/response is fine.
- Persisting conversation threads to the backend — thread is client-side, session-scoped.

## Key facts that shaped the design (verified in repo)

- The LLM gateway (M3, `app/llm/client.py`) is an **internal Python API**
  (`await llm.chat(messages, purpose=..., user_id=..., session=..., use_cache=...)`).
  Its only HTTP surface is an owner-only `/admin/llm/ping`. So the frontend cannot call
  the gateway directly — we add an application endpoint that uses it server-side.
- `app/guidance` already does LLM Q&A, but it is **RAG over a curated cross-border/tax
  corpus**, not analysis of the user's own transactions. We do not reuse it for the
  analyst; we add a new `app/analyst` module.
- The provider key `Settings.llm_api_key` defaults to `""`. When unset (or the provider
  errors) the gateway raises `LLMError`. The analyst must **degrade gracefully**: Monitor
  still works (no LLM); Explain/Plan/Action return a clear "AI unavailable" result.
- Reusable aggregate sources already exist and MUST be reused for the snapshot rather than
  recomputed: `app/analytics/service.py` → `summary`, `breakdown`, `net_worth`,
  `list_budgets`, `recommendations`; `app/widget_data/service.py` →
  `list_recurring_series`, `list_credit_cards`, `list_holdings`. All are household-scoped
  via `scoped_query`.
- Frontend data access is a typed `openapi-fetch` client (`web/lib/api/client.ts`) against
  the generated `@shared/api-schema`, wrapped in TanStack Query hooks (pattern:
  `web/lib/api/guidance.ts`). New endpoints → regenerate schema → new hook file.
- Existing floating-glass reference: `web/components/dashboard/grid/personalize/
  personalize-pane.tsx` (glass styling) — but it is an inline accordion. The analyst pane
  is a **true fixed floating overlay**.
- Privacy masking exists: `PrivacyProvider` + `<Private>`
  (`web/components/dashboard/privacy-provider.tsx`).

## Architecture

Two coupled halves of one feature: a backend `analyst` module and a frontend
`analyst` component tree, joined by two new typed endpoints.

### Backend — `backend/app/analyst/`

New module (`__init__.py`, `router.py`, `schemas.py`, `service.py`, `snapshot.py`),
registered in the app router alongside `guidance`/`analytics`.

**`snapshot.py` — `build_snapshot(session, user, range) -> FinancialSnapshot`**
Assembles one compact, LLM-ready snapshot of the household's finances for the given
range, reusing the analytics/widget_data services above. Contents:

- cashflow: income, expenses, net, and prior-period deltas (`analytics.summary`)
- top budget overages and near-limit categories (`analytics.list_budgets`)
- top spending categories / merchants (`analytics.breakdown`)
- net worth: assets, liabilities, total, trend (`analytics.net_worth`)
- recurring: upcoming items + total monthly cost (`widget_data.list_recurring_series`)
- credit cards: balances, utilization, next due (`widget_data.list_credit_cards`)
- recent large/unusual transactions and open recommendations (`analytics.recommendations`)

The snapshot is a Pydantic model serialized to compact JSON for the prompt, and is also
the deterministic input to the Monitor feed (one source of truth).

**Endpoints (`router.py`)**

- `GET /analyst/monitor?range=` → `MonitorOut { alerts: AnalystAlert[] }`.
  **No LLM.** Derives alert cards from the snapshot + `recommendations`. Each
  `AnalystAlert`: `{ id, kind, severity (0-10), tone (positive|info|warning|danger),
  title, detail, suggested_action?: AnalystAction }`. Deterministic and cacheable.
- `POST /analyst/ask` → body `AnalystAskIn { mode: "explain"|"plan"|"action",
  question: str, range?: str }`, response `AnalystAskOut { answer: str,
  suggestions: AnalystAction[], available: bool }`.
  Builds the snapshot, calls `llm.chat()` with a **mode-specific system prompt**:
  - explain — diagnostic: explain *why* a metric changed, grounded only in the snapshot.
  - plan — advisory: budget/debt-payoff/savings planning from the snapshot.
  - action — returns prose + a structured `suggestions` list of proposed actions.
  On missing key / `LLMError`: return `{ answer: <clear unavailable message>,
  suggestions: [], available: false }` with HTTP 200 (not an error status) so the UI
  renders a graceful state. Action `suggestions` use a closed `AnalystAction` schema:
  `{ type, label, params }` where `type` ∈ a fixed allow-list (see Action mode).
  All endpoints are `get_current_user`-scoped; usage is logged by the gateway as today.

**`service.py`** holds the prompt builders, the monitor-derivation logic, and the
ask orchestration (snapshot → prompt → chat → parse). Kept free of FastAPI types so it
is unit-testable with a mocked `LLMClient` (mirrors `guidance` tests).

### Frontend — `web/components/dashboard/analyst/`

- `use-analyst.tsx` — React context/provider holding: `open`, `mode`
  (`monitor|explain|plan|action`), the client-side chat thread per mode, and snooze/
  dismiss state for monitor alerts (localStorage, keyed `cf-analyst-dismissed`). Exposes
  `open()/close()/toggle()`, `setMode`, `ask()`, `runAction()`. Consumed by blob + pane.
- `analyst-blob.tsx` — the **bottom-right floating blob (FAB)**. `fixed bottom-6 right-6
  z-50`, glass/gradient circular button, Sparkles icon, a count badge of unread (non-
  dismissed) monitor alerts, and a soft pulse ring when any alert severity ≥ 7. Always
  rendered. Click toggles the pane. `aria-label`, focus ring, respects reduced-motion.
- `analyst-pane.tsx` — **true floating overlay**: a right-anchored glass panel
  (`fixed`, slides in from the right, blur, `shadow-card`, max-width ~420px, full-height
  with internal scroll), dismissible (close button + Esc + click-outside), widgets remain
  visible behind it (no canvas squeeze). Header with title + mode tabs
  **Monitor · Explain · Plan · Action**; body switches on mode.
- `monitor-feed.tsx` — renders `useMonitor()` alert cards (severity-sorted, grouped by
  tone). Amounts wrapped in `<Private>`. Each card may show an inline action button
  (Open budget / Snooze / Dismiss). Snooze/dismiss update the provider's localStorage set.
  Loading = skeleton; empty = "All clear" state; error = retry.
- `chat-thread.tsx` — shared by Explain/Plan/Action. A scrollable message list +
  composer. Mode-specific suggested-prompt chips seed the input. Submitting calls
  `useAnalystAsk()` with the active mode. Renders the `unavailable` state distinctly when
  `available === false` (e.g., "Connect an AI provider to use the analyst").
- `action-card.tsx` — renders an `AnalystAction` suggestion with a **Confirm** button.
  No action auto-executes. Confirm calls `runAction()` (see Action mode).
- `web/lib/api/analyst.ts` — `useMonitor(range)` (query) and `useAnalystAsk()` (mutation),
  following the `guidance.ts` `unwrap` pattern and generated types.

**Wiring** (`web/app/(app)/dashboard/page.tsx`): wrap the page in `<AnalystProvider>` and
render `<AnalystBlob/>` + `<AnalystPane/>` (fixed, floating over the grid). The provider
needs the dashboard `controller` (for the create-widget action) and `setMode`/personalize
hooks — passed via props.

**Removal**: delete the `analyst-toggle` stub button from
`web/components/dashboard/controls/dashboard-controls.tsx` and correct its header/inline
comments (drop "Analyst toggle (G)"; it is now the blob). No other control opens an
analyst surface, so nothing else changes there.

## The four modes — all real

- **Monitor** — real, data-derived alert feed from `/analyst/monitor`. Inline actions:
  open the relevant budget/widget, snooze, dismiss (client state this slice).
- **Explain** — chat; LLM answers "why did X change?" grounded in the snapshot.
- **Plan** — chat; LLM produces budget / debt-payoff / savings plans from the snapshot.
- **Action** — LLM proposes structured `AnalystAction`s the user **confirms**
  (no blind execution — finance trust). `runAction()` maps a closed allow-list of
  `type`s to **real** capabilities:
  - `create_widget` → existing dashboard `controller` add op (client board mutation).
  - `open_personalize` → open the Personalize pane on a given tab.
  - `focus_widget` → scroll/highlight a widget on the canvas.
  - `set_budget` → budgets API (`analytics.create_budget`) via confirm.
  - `snooze_alert` / `dismiss_alert` → client monitor state.
  Suggestions whose `type` is not in the allow-list render as **advice text only**
  (never a dead button).

## Cross-cutting

- **Privacy**: monetary values in Monitor cards wrapped in `<Private>`. The snapshot is
  sent to the configured provider only when a key is set; this is noted in the UI's
  empty/unavailable copy and in the spec. No special privacy gating beyond existing levels
  this slice.
- **Errors / degradation**: every LLM path falls back to an `available:false` result;
  Monitor never depends on the LLM. Network errors surface a retry affordance.
- **Accessibility**: pane is a labelled dialog-like region, Esc closes, focus moves into
  the pane on open and restores on close; blob has an `aria-label` and visible focus ring;
  pulse honors `prefers-reduced-motion`.

## Testing

- **Backend (pytest)**: `build_snapshot` against seeded data; `/analyst/monitor` returns
  expected alert kinds; `/analyst/ask` with a **mocked `LLMClient`** for each mode; the
  no-key path returns `available:false` with HTTP 200; household scoping enforced.
  Mirrors `tests/.../guidance` patterns.
- **Frontend (Vitest)**: monitor-feed rendering (severity sort, empty/error), the
  action `type → capability` mapper as a pure function, `unavailable` chat state.
- **E2E (`web/e2e/dashboard-grid.spec.ts` or a new spec)**: blob is visible → click opens
  the floating pane → switch modes → Monitor renders cards. (LLM modes are stubbed/mocked
  at the network layer to stay deterministic.)
- Repo gotchas: `next lint` is broken — verify with `tsc --noEmit`, `vitest run`,
  `playwright test`, and backend pytest in the api container (local `.venv` is broken).

## Suggested plan phasing

- **P1 — backend `app/analyst`**: snapshot builder, schemas, `/analyst/monitor` +
  `/analyst/ask`, router registration, pytest. Regenerate `@shared/api-schema`.
- **P2 — frontend shell**: provider, blob, floating pane, Monitor mode (`useMonitor`),
  page wiring, remove the toolbar toggle. Vitest + e2e for blob/pane/monitor.
- **P3 — Explain + Plan**: `chat-thread`, `useAnalystAsk`, suggested prompts, unavailable
  state.
- **P4 — Action mode**: `action-card`, `runAction` allow-list mapping, confirm flow,
  tests for the mapper.
