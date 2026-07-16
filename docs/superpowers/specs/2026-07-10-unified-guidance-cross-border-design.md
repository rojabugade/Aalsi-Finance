# Unified Guidance Workspace with Cross-border and My Plan

Date: 2026-07-10  
Status: implementation-ready draft, pending product review  
Target: Next.js web app + existing FastAPI guidance backend  
Follow-on: native iOS parity after the web/API contract stabilizes

## Decision

Replace the current **Ask / Plan** split with one Guidance workspace containing
**Overview**, **Cross-border**, and **My Plan**.

- **Ask is an interaction**, not a destination. A shared composer is available on
  Overview and Cross-border.
- **A plan is a saved outcome.** Answers and wizard checklist items can be saved as
  persistent plan items, then completed or dismissed in My Plan.
- **Cross-border remains inside Guidance** and becomes a first-class top section,
  not a separate product or route tree.
- Existing guidance remains educational and source-grounded. It does not recommend
  a specific security, allocation, transfer provider, or transaction.

The canonical URLs are:

| Section | URL |
| --- | --- |
| Overview | `/guidance` |
| Cross-border | `/guidance?section=cross-border` |
| My Plan | `/guidance?section=plan` |

`/guidance?tab=plan` remains a compatibility alias and renders My Plan. The drawer's
Cross-border entry links directly to `/guidance?section=cross-border`.

## Problem

The current Guidance surface makes users choose between two concepts that overlap:

- Ask is a one-shot form with country/topic fields and a separate Cross-border checkbox.
- Plan is another form with similar country and residency inputs.
- Cross-border is hidden behind Plan and then behind a local toggle.
- Wizard results are transient dictionaries. They cannot be saved, completed, or revisited.
- The guidance answer is source-backed, but the page does not preserve a coherent thread.
- `/guidance/ask` and `/cross-border/ask` call the same service; the same duplication exists
  for the wizard endpoints.

The result exposes backend routing choices instead of matching the user's job: understand a
question, determine what applies, and keep track of the next steps.

## Goals

1. Make Guidance understandable in under a minute without requiring users to understand
   the distinction between asking and planning.
2. Put Cross-border visibly inside Guidance with direct navigation.
3. Use one conversational interaction across general, investment-education, and
   cross-border questions.
4. Convert useful answers and checklist results into persistent plan items.
5. Make every factual answer verifiable through numbered, dated, typed citations.
6. Preserve current transfer tracking and remittance-limit functionality.
7. Keep the API additive and retain existing endpoints during migration.
8. Remain useful when the LLM is unavailable by returning deterministic corpus-grounded
   answers and keeping all plan/transfer workflows operational.

## Non-goals

- Live market-price/news ingestion or an India market briefing. That requires a separate
  source-quality, refresh, and licensing design.
- Personalized buy/sell/allocate recommendations.
- Executing investments, transfers, or trades.
- Automatically converting every answer into a plan item.
- Automated email/push delivery for plan due dates in this slice. Due dates are stored and
  shown in My Plan; notification delivery is a follow-on.
- Rebuilding the global Analyst pane. Guidance uses its own corpus, prompt, and thread keys.
- Native iOS Guidance UI in this execution plan.
- Removing legacy `/cross-border/ask` or `/cross-border/wizard` endpoints.

## Current state verified

- `web/app/(app)/guidance/page.tsx` renders Ask or Plan from `?tab=plan`; Plan locally
  switches between Wizard and Cross-border.
- `web/components/guidance/cross-border-module.tsx` already lists/creates transfers and
  renders totals, limits, warnings, and citations.
- `web/lib/api/guidance.ts` contains typed TanStack Query hooks for ask, wizard, transfers,
  and limits.
- `backend/app/guidance/service.py` already performs corpus retrieval, LLM fallback,
  checklist generation, transfer creation, limit parsing, and corpus reindexing.
- `/guidance/ask` and `/cross-border/ask` are aliases over the same service. The wizard
  endpoints are aliases too.
- `analyst_thread` and `analyst_message` already provide stable household-scoped server
  conversation storage. Guidance can reuse the storage helpers with user-prefixed keys.
- No persistent guidance-plan model exists.

## Information architecture

### 1. Overview

Overview is the default Guidance landing surface.

It contains:

1. A short orientation: “Ask a sourced money question or build a checklist you can keep.”
2. Contextual starter actions:
   - Review my financial readiness
   - Explore investing in India
   - Build my guidance plan
   - Check cross-border obligations
3. The shared Guidance conversation.
4. An inline plan-builder flow when “Build my guidance plan” is selected.
5. A compact preview of open My Plan items.

Country and topic remain available as progressive controls, not mandatory fields dominating
the first view. Defaults are `US` and `IN` only for the guided plan builder; an ordinary
question has no forced country.

### 2. Cross-border

Cross-border is a visible Guidance section with two connected areas:

- **Cross-border conversation:** the same composer, using the `cross_border` domain and a
  separate thread key. Starter questions cover residency, reporting, remittance rules,
  account types, and general tax concepts.
- **Cross-border tools:** transfer tracker, current totals, corpus-defined limits, warnings,
  and their source dates.

The page does not ask users to enable a “Cross-border specialised” checkbox. Section context
sets the domain automatically.

### 3. My Plan

My Plan is a persistent list of user-owned guidance items. It is not another AI chat mode.

Each item contains:

- title;
- optional rationale / “why this matters” text;
- domain: `general`, `investment`, or `cross_border`;
- status: `open`, `completed`, or `dismissed`;
- optional due date;
- source references captured when the item was saved;
- optional origin thread key;
- created and updated timestamps.

Default view shows open items first, ordered by due date and then newest. Completed and
dismissed items are available through status filters. Users can edit title/rationale/due date,
mark complete, reopen, or dismiss. Deletion is deliberately omitted so history is retained.

## Primary flows

### Ask and continue

1. User opens Overview or Cross-border.
2. Starter questions teach the supported capability; the composer also accepts free text.
3. The client posts the question, domain, optional country/topic, and a stable thread key.
4. The backend retrieves the current corpus, uses recent turns only for conversational
   context, and answers only from the current retrieved documents.
5. The response renders numbered citations matching bracket references in the answer.
6. The user can ask a follow-up or choose “Save to My Plan.”

“Save to My Plan” opens a small editable dialog prefilled from the question and answer. Saving
is always an explicit user action.

### Build a plan

1. User selects “Build my guidance plan” on Overview.
2. An inline guided form asks countries, residency, expected annual transfer amount/currency,
   and account types.
3. The existing wizard endpoint returns typed checklist suggestions with citations.
4. Each suggestion has an independent “Add to My Plan” action.
5. “Add all” requires one confirmation and creates only items not already saved with the same
   normalized title and domain.
6. Saved items appear immediately in the My Plan preview and full section.

The wizard does not create notifications as a side effect in the redesigned flow. Add
`create_reminders: bool = True` to `GuidanceWizardIn` for compatibility; the new frontend sends
`false`, while existing callers that omit it keep today's behavior. Returned `reminders` are
not durable plan state.

### Work through Cross-border

1. User enters Cross-border directly from Guidance tabs or the drawer.
2. The top summary shows the highest-severity warning, transfer total summary, and source
   freshness state.
3. The conversation answers cross-border questions in the same page context.
4. Transfer logging invalidates transfers and limits so totals/warnings update together.
5. Any answer, warning, or checklist suggestion can be saved to My Plan with domain
   `cross_border`.

## Trust and advisory boundaries

The existing disclaimer remains visible on every answer and checklist result. In addition:

- Answers must cite bracket numbers (`[1]`, `[2]`) corresponding to the rendered source list.
- Every source row displays source type and effective date. Missing effective dates are shown
  as “Date unavailable,” not hidden.
- Official/government, community, and other sources receive distinct text labels; color is
  secondary and never the only distinction.
- Conversation history is context only. It cannot override the documents retrieved for the
  current turn.
- If retrieval returns no documents, the backend states that it could not find relevant
  guidance and does not call the LLM.
- If the LLM fails, the deterministic source summary remains available.
- Cross-border limit warnings continue to say the threshold is corpus-defined and must be
  verified against the cited source.
- Plan items are user-authored records of considerations, not product endorsements.

## Backend design

### Guidance conversation contracts

Extend the existing request/response additively:

```python
GuidanceDomain = Literal["general", "investment", "cross_border"]

class GuidanceAskIn(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    country: str | None = None
    topic: str | None = None
    domain: GuidanceDomain = "general"
    thread_id: str | None = Field(default=None, max_length=96)

class GuidanceAskOut(BaseModel):
    answer: str
    citations: list[Citation]
    disclaimer: str
    thread_id: str | None = None

class GuidanceThreadMessage(BaseModel):
    role: Literal["user", "analyst"]
    text: str
    citations: list[Citation] = Field(default_factory=list)
    disclaimer: str | None = None

class GuidanceThreadOut(BaseModel):
    messages: list[GuidanceThreadMessage] = Field(default_factory=list)
```

Add:

```text
GET /guidance/thread/{key}/messages -> GuidanceThreadOut
```

Thread keys supplied by the client are transformed server-side to
`guidance:{user.id}:{key}` before using `analyst_thread`. This keeps guidance threads personal
inside the household-scoped conversation table and prevents collisions with Analyst threads.

Add nullable `payload JSONB` to `analyst_message`. For guidance analyst messages it stores
`{"citations": [...], "disclaimer": "..."}`. Existing Analyst messages continue to use null.
The shared `append_turn` helper accepts an optional analyst payload without changing existing
callers.

`ask_guidance` loads at most six recent messages. The prompt clearly separates:

- prior conversation, used only to resolve references and follow-up intent;
- current corpus, the only allowed factual authority for the response.

The compatibility `/cross-border/ask` route forces `domain="cross_border"` before delegating.

### Typed wizard result

Replace opaque checklist dictionaries in the schema with a typed additive representation:

```python
class GuidanceChecklistItem(BaseModel):
    title: str
    topic: str | None = None
    source_type: str | None = None
    why_it_may_apply: str
    source_url: str | None = None
    effective_date: date | None = None
    domain: GuidanceDomain
```

`GuidanceWizardOut.checklist` becomes `list[GuidanceChecklistItem]`. The JSON shape is
compatible with the existing frontend while generated TypeScript becomes useful.
`GuidanceWizardIn` also gains additive `create_reminders: bool = True`; the redesigned builder
sends `false` so checklist generation has no notification side effect.

### Persistent plan item

Add `GuidancePlanItem`:

```text
guidance_plan_item
  id UUID PK
  household_id UUID FK household.id CASCADE, indexed
  user_id UUID FK user.id CASCADE, indexed
  domain VARCHAR CHECK general|investment|cross_border
  title VARCHAR(240)
  rationale TEXT nullable
  status VARCHAR CHECK open|completed|dismissed, default open
  due_date DATE nullable
  source_refs JSONB nullable
  origin_thread_key VARCHAR(96) nullable
  created_at TIMESTAMPTZ default now
  updated_at TIMESTAMPTZ default now/on update
```

All service queries require both `household_id == user.household_id` and
`user_id == user.id`. Plan items are personal by default even when financial data is shared.

Add contracts:

```text
GET    /guidance/plan-items?status=open|completed|dismissed
POST   /guidance/plan-items
PATCH  /guidance/plan-items/{id}
```

`POST` accepts title, rationale, domain, due date, source refs, and origin thread key. `PATCH`
allows title, rationale, status, and due date. Duplicate prevention applies on create when the
same user has an open item with the same normalized title and domain; return the existing item
instead of creating another row.

## Frontend design

### Component boundaries

```text
web/app/(app)/guidance/page.tsx
  GuidanceWorkspace
    GuidanceOverview
      GuidanceConversation
      PlanBuilder
      PlanPreview
    CrossBorderGuidance
      GuidanceConversation
      CrossBorderModule
    GuidancePlan
      PlanFilters
      PlanItemRow

web/components/guidance/
  guidance-conversation.tsx
  guidance-answer.tsx
  plan-builder.tsx
  plan-item-dialog.tsx
  plan-list.tsx
  cross-border-guidance.tsx
  cross-border-module.tsx (existing, refactored)
  citations.tsx (existing, upgraded)
```

`GuidanceWorkspace` derives the section from `useSearchParams`:

- missing/unknown `section` -> Overview;
- `section=cross-border` -> Cross-border;
- `section=plan` or legacy `tab=plan` -> My Plan.

Shell top tabs become Overview, Cross-border, and My Plan. No nested local tab state remains.

### Conversation behavior

The two stable client thread keys are:

- Overview: `overview`
- Cross-border: `cross-border`

The conversation component receives `domain`, `threadId`, starter prompts, and optional
default country/topic. It owns draft input and hydrated server messages. User input survives a
failed request. Pending state adds a non-blocking “Searching the guidance corpus…” message;
the rest of the page remains usable.

Each analyst answer renders:

- answer text;
- numbered citation cards;
- disclaimer;
- Save to My Plan action.

### Plan behavior

Plan mutations update the `['guidance', 'plan-items']` query cache or invalidate that prefix.
Rows use explicit text buttons for Complete, Reopen, Edit, and Dismiss. Status changes are
optimistic only if rollback is implemented; otherwise show the short pending state and update
after success.

The plan preview shows at most three open items and links to My Plan. Empty state sends the user
back to Overview with “Ask a question” and “Build my plan” actions.

### Cross-border behavior

The existing `CrossBorderModule` remains responsible for transfers and limits. It is refactored
to accept an optional `onSaveWarning` callback so warning rows can create plan items without
owning plan API state.

Creating a transfer invalidates both:

- `['cross-border', 'transfers']`
- `['cross-border', 'limits']`

This fixes the current stale-limit window after logging a transfer.

## Loading, empty, error, and degraded states

| Surface | Loading | Empty | Error/degraded |
| --- | --- | --- | --- |
| Conversation history | compact skeleton messages | starter prompts | composer remains; retry history |
| New answer | inline progress row | n/a | preserve draft/turn; retry action |
| Plan | row skeletons | explain how to create first item | retry without hiding navigation |
| Transfers | existing skeleton | “No transfers logged” + CTA | inline retry |
| Limits | existing skeleton | no corpus-defined limits found | show totals if available; retry limits |
| LLM unavailable | n/a | n/a | deterministic cited answer; no AI-only blocker |

## Accessibility and responsive behavior

- Shell section navigation uses real links/tabs with an active state derived from the URL.
- Starter prompts and plan actions are buttons with visible focus rings.
- Conversation updates use a polite live region; pending progress is not repeatedly announced.
- Source type is written as text and not communicated by color alone.
- Dialogs have labelled titles/descriptions and return focus to their trigger.
- Desktop Overview uses conversation + plan preview columns; mobile stacks conversation first.
- Cross-border tools stack below the conversation on mobile and use two columns on wide screens.
- All status controls remain reachable without hover.

## Compatibility and migration

- Existing `/guidance/ask`, `/guidance/wizard`, transfer, limit, and reindex contracts remain.
- `/cross-border/ask` and `/cross-border/wizard` remain compatibility aliases.
- Existing PWA monolith calls continue to work because new request fields are optional and old
  response fields remain.
- `?tab=plan` maps to the new My Plan section; no hard redirect is required.
- No existing data backfill is required. My Plan begins empty.
- The migration adding `guidance_plan_item` and `analyst_message.payload` is reversible.

## Testing

### Backend

- Migration upgrade/downgrade shape.
- Plan CRUD, duplicate prevention, status filtering, and strict user isolation.
- Thread keys are user-prefixed and cannot reveal another household member's thread.
- Guidance history returns stored citations.
- Follow-up questions include prior context but answers remain grounded in current retrieval.
- Cross-border alias forces the cross-border domain.
- No-doc and LLM-failure fallbacks remain non-throwing.

### Frontend unit

- URL section parser including legacy `?tab=plan`.
- Conversation starter prompt, submit, history hydration, error draft preservation, and Save.
- Citation numbering/type/date/missing-date rendering.
- Plan builder item-by-item save and add-all de-duplication behavior.
- Plan list filtering and status mutations.
- Transfer creation invalidates both transfers and limits.

### End-to-end

1. Open Guidance and ask a question; see an answer and source list.
2. Save the answer to My Plan; navigate to My Plan and mark it complete.
3. Open Cross-border directly from its tab; log a transfer and see refreshed totals/limits.
4. Build a checklist and save one item to My Plan.
5. Verify legacy `/guidance?tab=plan` renders My Plan.

## Rollout and completion criteria

The change ships in one feature branch but is implemented as vertical slices:

1. persistent plan item walking skeleton;
2. threaded cited Guidance conversation;
3. new workspace navigation;
4. Cross-border integration;
5. wizard-to-plan conversion and full verification.

Done means:

- Overview, Cross-border, and My Plan are directly navigable and URL-addressable;
- Ask and Plan are no longer peer tabs;
- one composer supports general and cross-border conversations;
- users can save, edit, complete, reopen, and dismiss plan items;
- Cross-border transfers/limits work inside Guidance and refresh together;
- citations show number, source type, and effective date;
- compatibility URLs/endpoints still work;
- backend tests, frontend unit tests, typecheck, build, and Guidance Playwright coverage pass.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Conversation history repeats stale claims | Current retrieved corpus is explicitly the only factual authority per turn. |
| Personal plan leaks to household members | Thread keys are user-prefixed; plan queries filter household and user. |
| “Plan” reads as regulated advice | UI says checklist/considerations; disclaimer persists; no asset/transfer execution. |
| Wizard creates duplicate items | Normalize title+domain and return an existing open item on duplicate create. |
| Cross-border totals look current after mutation but limits are stale | Invalidate both query keys on transfer create. |
| Generated schema breaks old callers | All ask fields are optional/additive; old endpoints and response fields remain. |
| Scope expands into live investing data | Market briefing is a documented non-goal and requires its own design. |

## Defaults taken

- Web/API is the first implementation target; native iOS follows the stabilized contract.
- My Plan is user-private, not household-shared.
- Plan due dates are stored but do not send notifications in this slice.
- The old wizard remains as an API capability but appears inline from Overview.
- Conversation history persists server-side and retains citations.
- The term “analyst” remains the stored message role for compatibility; the UI calls the
  surface Guidance.
