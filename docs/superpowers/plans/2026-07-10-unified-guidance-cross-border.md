# Unified Guidance + Cross-border Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to execute this plan task-by-task. Track progress by changing
> each `- [ ]` checkbox only after its verification command passes.

**Goal:** Replace the Ask/Plan split with one Guidance workspace containing Overview,
Cross-border, and My Plan; use one cited conversational interaction; and persist useful answers
and wizard checklist items as user-owned plan records.

**Architecture:** Extend the existing guidance API additively. Reuse the server conversation
tables with user-prefixed Guidance thread keys and add citation payloads to stored analyst
messages. Add a new user-scoped `guidance_plan_item` table and CRUD API. On the frontend, URL
query state selects Overview, Cross-border, or My Plan; a shared `GuidanceConversation` appears
on Overview and Cross-border; the existing wizard becomes an inline plan-builder; and the
existing transfer/limits module stays nested in Cross-border.

**Tech stack:** FastAPI, Pydantic v2, SQLAlchemy async, Alembic, Postgres/pgvector,
pytest/pytest-asyncio; Next.js 16 App Router, React 19, TanStack Query 5, openapi-fetch,
Tailwind, Vitest/React Testing Library, Playwright.

**Design:** `docs/superpowers/specs/2026-07-10-unified-guidance-cross-border-design.md`

## Global constraints

- Keep all current Guidance and Cross-border endpoints working. New request fields are
  optional/additive.
- Never hand-edit `shared/api-schema.ts`; regenerate it from the running FastAPI OpenAPI.
- Money remains `Decimal` in Python and serialized according to the generated schema.
- All plan queries must filter both household and current user.
- Guidance answers use only the current retrieved corpus as factual authority. Thread history
  is context, not a source.
- No personalized buy/sell/allocate instructions and no money movement.
- The LLM remains optional. Corpus fallback, plan CRUD, transfers, and limits work without it.
- Do not add npm or Python dependencies.
- Use existing design tokens (`bg-card`, `bg-chip`, `text-fg`, `text-muted`, `border-border`,
  `text-accent`) and existing UI primitives.
- Do not modify the native `Alsi/` app in this plan.
- Commit after each task with the commit shown or an equivalent Conventional Commit message.

## Task order and dependency map

```text
T1 model/migration
  -> T2 plan API
      -> T4 generated client
          -> T5 navigation shell
              -> T8 My Plan UI

T1 message payload
  -> T3 threaded Guidance API
      -> T4 generated client
          -> T6 conversation + citations
              -> T7 Overview planner
              -> T9 Cross-border composition

T7 + T8 + T9 -> T10 end-to-end closeout
```

The walking skeleton is T1 + T2 + the plan portion of T4 + T8: create one plan item through
the API, render it, and complete it before polishing the rest of Guidance.

---

## Task 1: Add persistent plan items and message payload storage

**Files:**

- Modify: `backend/app/models/guidance.py`
- Modify: `backend/app/models/conversation.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/migrations/versions/p4e1f2a3b5c6_m30_guidance_plan_items.py`
- Test: `backend/tests/test_m30_guidance_plan.py`

**Produces:** `GuidancePlanItem`; nullable `AnalystMessage.payload`; migration revision
`p4e1f2a3b5c6` down from current head `o3d0e1f2a4b5`.

- [ ] **Step 1: Write the failing model test.** Create
  `backend/tests/test_m30_guidance_plan.py` with a database fixture matching
  `backend/tests/test_m10_guidance.py`. Assert that a plan item can be inserted with:
  `domain="cross_border"`, `status="open"`, a due date, and citation-shaped `source_refs`;
  assert `AnalystMessage(payload={"citations": []})` also persists.
- [ ] **Step 2: Run the test and confirm failure.**

  ```bash
  docker compose exec api pytest -q tests/test_m30_guidance_plan.py
  ```

  Expected: import/column failure because the model does not exist yet.

- [ ] **Step 3: Add `GuidancePlanItem`.** In `backend/app/models/guidance.py`, add the model
  described in the design. Use `uuid_pk`, `fk_uuid`, `str_enum`, `JSONB`, `Date`, `DateTime`,
  `func.now()`, and explicit `created_at`/`updated_at`. Required fields:

  ```python
  id, household_id, user_id, domain, title, rationale, status,
  due_date, source_refs, origin_thread_key, created_at, updated_at
  ```

  Constraints:
  `domain in (general, investment, cross_border)` and
  `status in (open, completed, dismissed)`.
- [ ] **Step 4: Add nullable `payload: JSONB` to `AnalystMessage`.** Do not rename the table or
  change existing role values.
- [ ] **Step 5: Export/import the new model** from `backend/app/models/__init__.py` so metadata
  discovery includes it.
- [ ] **Step 6: Write the Alembic migration.** Upgrade creates `guidance_plan_item`, indexes
  household/user, checks/enums following the repo's `native_enum=False` convention, and adds
  `analyst_message.payload`. Downgrade drops payload, indexes, and the table in reverse order.
- [ ] **Step 7: Apply migration and rerun the test.**

  ```bash
  docker compose exec api alembic upgrade head
  docker compose exec api pytest -q tests/test_m30_guidance_plan.py
  ```

  Expected: pass.

- [ ] **Step 8: Commit.**

  ```bash
  git add backend/app/models/guidance.py backend/app/models/conversation.py backend/app/models/__init__.py backend/migrations/versions/p4e1f2a3b5c6_m30_guidance_plan_items.py backend/tests/test_m30_guidance_plan.py
  git commit -m "feat(guidance): persist user plan items"
  ```

---

## Task 2: Add user-scoped plan CRUD API

**Files:**

- Modify: `backend/app/guidance/schemas.py`
- Modify: `backend/app/guidance/service.py`
- Modify: `backend/app/guidance/router.py`
- Test: `backend/tests/test_m30_guidance_plan.py`

**Produces:**

```text
GET   /guidance/plan-items?status=
POST  /guidance/plan-items
PATCH /guidance/plan-items/{id}
```

- [ ] **Step 1: Add failing service tests** for create/list/update, duplicate create, status
  filtering, and isolation between two users in the same household. Required assertions:
  - duplicate normalized title + domain returns the existing open row;
  - a completed row does not block creating a new open item later;
  - user B cannot list or update user A's item;
  - updating a missing/foreign item raises the domain `NotFound` error used elsewhere.
- [ ] **Step 2: Add Pydantic contracts** in `schemas.py`:

  ```python
  GuidanceDomain = Literal["general", "investment", "cross_border"]
  GuidancePlanStatus = Literal["open", "completed", "dismissed"]
  GuidancePlanItemCreate
  GuidancePlanItemUpdate
  GuidancePlanItemOut  # ConfigDict(from_attributes=True)
  ```

  Create fields: title (1..240), rationale, domain, due_date, source_refs, origin_thread_key.
  Update fields: optional title, rationale, status, due_date. Use `model_fields_set` in the
  service so an explicit null can clear rationale/due date.
- [ ] **Step 3: Implement service functions** `list_plan_items`, `create_plan_item`, and
  `update_plan_item`. Normalize duplicate titles with trimmed/collapsed whitespace and
  lowercase comparison. Never accept household/user IDs from the request body.
- [ ] **Step 4: Add router endpoints.** `PATCH` returns 404 for `NotFound`. Status query is
  optional; without it return all rows ordered open first, due date nulls last, then newest.
- [ ] **Step 5: Run backend tests.**

  ```bash
  docker compose exec api pytest -q tests/test_m30_guidance_plan.py tests/test_m10_guidance.py
  ```

  Expected: pass; M10 compatibility remains green.
- [ ] **Step 6: Commit.**

  ```bash
  git add backend/app/guidance/schemas.py backend/app/guidance/service.py backend/app/guidance/router.py backend/tests/test_m30_guidance_plan.py
  git commit -m "feat(guidance): add plan item API"
  ```

---

## Task 3: Make Guidance conversational while preserving citations

**Files:**

- Modify: `backend/app/analyst/conversation.py`
- Modify: `backend/app/guidance/schemas.py`
- Modify: `backend/app/guidance/service.py`
- Modify: `backend/app/guidance/router.py`
- Test: `backend/tests/test_m10_guidance.py`
- Test: `backend/tests/test_m30_guidance_plan.py`

**Produces:** additive `domain`/`thread_id` request fields, `thread_id` response field, and
`GET /guidance/thread/{key}/messages`.

- [ ] **Step 1: Extend conversation helper tests.** Add a focused test proving
  `append_turn(..., analyst_payload=...)` stores payload only on the analyst message and leaves
  existing no-payload calls valid.
- [ ] **Step 2: Modify `append_turn`** in `backend/app/analyst/conversation.py`:

  ```python
  async def append_turn(..., analyst_payload: dict | None = None) -> None
  ```

  Set `payload=analyst_payload` only on the analyst row. Do not change Analyst callers.
- [ ] **Step 3: Extend Guidance schemas** exactly as specified in the design:
  `GuidanceAskIn.domain`, `GuidanceAskIn.thread_id`, `GuidanceAskOut.thread_id`,
  `GuidanceThreadMessage`, and `GuidanceThreadOut`. Add validation for empty questions and
  maximum key/question lengths.
- [ ] **Step 4: Add failing guidance conversation tests.** Cover:
  - first ask creates `guidance:{user.id}:overview`;
  - second ask includes recent turns in the LLM user content;
  - stored response history returns citations and disclaimer;
  - another user requesting `overview` gets a distinct thread;
  - no-doc response persists safely without calling the LLM;
  - `/cross-border/ask` forces `cross_border` domain.
- [ ] **Step 5: Implement private thread-key translation:**

  ```python
  def _guidance_thread_key(user: User, client_key: str) -> str:
      return f"guidance:{user.id}:{client_key.strip()[:96]}"
  ```

  Do not expose the prefixed database key back to the client.
- [ ] **Step 6: Update `ask_guidance`.** When `thread_id` exists, load at most six recent
  turns and place them under a clearly labelled `Conversation context` block. Place retrieved
  documents under `Current authoritative corpus`. The system prompt must say only the latter
  may support factual claims. Persist the answer with citation/disclaimer payload.
- [ ] **Step 7: Implement `guidance_thread_history`.** Return oldest-first messages and parse
  analyst payload into citations/disclaimer. A nonexistent key returns an empty message list;
  it may create the scoped empty thread, matching current Analyst behavior.
- [ ] **Step 8: Update compatibility route behavior.** `/cross-border/ask` copies the input
  with `domain="cross_border"` before delegation. Do not mutate shared request state in place.
- [ ] **Step 9: Type the wizard checklist and control reminder side effects.** Add
  `GuidanceWizardIn.create_reminders: bool = True`; call `enqueue_notification` only when it is
  true. Add `GuidanceChecklistItem` and return
  `list[GuidanceChecklistItem]` while retaining the same JSON keys. Assign domain:
  `cross_border` for cross-border/remittance/tax-reporting topics, `investment` for investment
  education, otherwise `general`.
- [ ] **Step 10: Run focused backend tests.**

  ```bash
  docker compose exec api pytest -q tests/test_m10_guidance.py tests/test_m30_guidance_plan.py
  ```

  Expected: pass.
- [ ] **Step 11: Commit.**

  ```bash
  git add backend/app/analyst/conversation.py backend/app/guidance/schemas.py backend/app/guidance/service.py backend/app/guidance/router.py backend/tests/test_m10_guidance.py backend/tests/test_m30_guidance_plan.py
  git commit -m "feat(guidance): add cited conversation threads"
  ```

---

## Task 4: Regenerate OpenAPI types and expand Guidance hooks

**Files:**

- Regenerate: `shared/api-schema.ts`
- Modify: `web/lib/api/guidance.ts`
- Create: `web/lib/api/guidance.test.ts`

**Produces:** typed hooks for conversation history and plan CRUD; transfer create invalidates
limits as well as transfers.

- [ ] **Step 1: Start/verify the API** at `http://localhost:8000` using the existing compose
  workflow.
- [ ] **Step 2: Regenerate types.** From `web/`:

  ```bash
  npm run gen:api
  ```

  Expected: `shared/api-schema.ts` contains `GuidancePlanItemOut`,
  `GuidanceThreadOut`, and `/guidance/plan-items`.
- [ ] **Step 3: Add API hook tests** mocking `api`. Cover query keys, endpoint bodies, plan
  invalidation, and transfer invalidation of both transfers and limits.
- [ ] **Step 4: Add `useGuidanceAsk`.** Accept `AskIn` directly; callers set `domain`. Retain
  the existing `useAsk({crossBorder, body})` wrapper through T4 so the current page still
  typechecks. The new hook signature is:

  ```ts
  useGuidanceAsk(): UseMutationResult<AskOut, unknown, AskIn>
  ```
- [ ] **Step 5: Add:**

  ```ts
  useGuidanceThread(key)
  usePlanItems(status?)
  useCreatePlanItem()
  useUpdatePlanItem()
  ```

  Export generated aliases for `GuidancePlanItemOut`, create/update inputs, and
  `GuidanceChecklistItem`. Define
  `type GuidanceDomain = NonNullable<AskIn["domain"]>` rather than assuming OpenAPI emits a
  standalone schema for the Python type alias.
- [ ] **Step 6: Update `useCreateTransfer`** to invalidate both
  `['cross-border','transfers']` and `['cross-border','limits']`.
- [ ] **Step 7: Run unit test and typecheck.**

  ```bash
  cd web
  npx vitest run lib/api/guidance.test.ts
  npx tsc --noEmit
  ```

  Expected: pass.
- [ ] **Step 8: Commit.**

  ```bash
  git add shared/api-schema.ts web/lib/api/guidance.ts web/lib/api/guidance.test.ts
  git commit -m "feat(web): add unified guidance API hooks"
  ```

---

## Task 5: Replace Ask/Plan shell tabs with section navigation

**Files:**

- Modify: `web/lib/shell/nav.ts`
- Modify: `web/app/(app)/guidance/page.tsx`
- Create: `web/components/guidance/section.ts`
- Create: `web/components/guidance/section.test.ts`

**Produces:** URL-addressable Overview, Cross-border, and My Plan shell with legacy alias.

- [ ] **Step 1: Write parser tests** for:

  ```ts
  guidanceSection(searchParams): "overview" | "cross-border" | "plan"
  ```

  Cases: no params, each valid `section`, unknown section, and legacy `tab=plan`.
- [ ] **Step 2: Implement the parser** as a pure helper in `section.ts`.
- [ ] **Step 3: Update shell tabs** in `web/lib/shell/nav.ts`:

  ```ts
  Overview     /guidance
  Cross-border /guidance?section=cross-border
  My Plan      /guidance?section=plan
  ```

  Update drawer Cross-border href to its direct section URL and Guidance sublabel to
  `Sourced answers & saved plans`.
- [ ] **Step 4: Replace page branching** with `GuidanceWorkspace` section selection. For this
  task, render labelled placeholders for each new section so navigation can be tested before
  feature components land. Delete local `planView` and all Cross-border checkbox state. After
  the old page call sites are gone, remove the temporary legacy `useAsk` wrapper from
  `web/lib/api/guidance.ts`; keep `useGuidanceAsk` as the only new-conversation hook.
- [ ] **Step 5: Run parser test and typecheck.**

  ```bash
  cd web
  npx vitest run components/guidance/section.test.ts
  npx tsc --noEmit
  ```

- [ ] **Step 6: Commit.**

  ```bash
  git add web/lib/shell/nav.ts "web/app/(app)/guidance/page.tsx" web/components/guidance/section.ts web/components/guidance/section.test.ts
  git commit -m "refactor(web): unify guidance section navigation"
  ```

---

## Task 6: Build the shared cited Guidance conversation

**Files:**

- Create: `web/components/guidance/guidance-conversation.tsx`
- Create: `web/components/guidance/guidance-conversation.test.tsx`
- Create: `web/components/guidance/guidance-answer.tsx`
- Modify: `web/components/guidance/citations.tsx`
- Create: `web/components/guidance/citations.test.tsx`

**Produces:** reusable conversation for Overview and Cross-border.

- [ ] **Step 1: Write citation tests.** Assert numbered source rows, explicit source type,
  effective date, “Date unavailable,” safe external-link attributes, and no output for an
  empty list.
- [ ] **Step 2: Upgrade `Citations`.** Keep `KeyValues`/`DictList` exports for existing
  consumers. Render each citation as `[n] Title`, source-type badge text, and date.
- [ ] **Step 3: Write conversation tests.** Mock hooks and cover:
  - server history hydration;
  - starter prompt submission;
  - free-text submission with domain/thread/country/topic;
  - pending progress text;
  - failed request preserves the user's draft and offers retry;
  - response displays citations/disclaimer;
  - Save to My Plan invokes a callback with question, answer, citations, domain, and thread.
- [ ] **Step 4: Implement `GuidanceAnswer`.** It receives an answer result and an
  `onSave` callback. Use a normal button; do not auto-save.
- [ ] **Step 5: Implement `GuidanceConversation`.** Props:

  ```ts
  {
    domain: GuidanceDomain;
    threadId: "overview" | "cross-border";
    prompts: string[];
    defaultCountry?: string;
    defaultTopic?: string;
    onSave: (draft: PlanDraft) => void;
  }
  ```

  Use a local message array hydrated once from `useGuidanceThread`. Keep country/topic in a
  collapsible/progressive control. Use `aria-live="polite"` around new answers.
- [ ] **Step 6: Run tests and typecheck.**

  ```bash
  cd web
  npx vitest run components/guidance/citations.test.tsx components/guidance/guidance-conversation.test.tsx
  npx tsc --noEmit
  ```

- [ ] **Step 7: Commit.**

  ```bash
  git add web/components/guidance/guidance-conversation.tsx web/components/guidance/guidance-conversation.test.tsx web/components/guidance/guidance-answer.tsx web/components/guidance/citations.tsx web/components/guidance/citations.test.tsx
  git commit -m "feat(web): add cited guidance conversation"
  ```

---

## Task 7: Build Overview and convert wizard output into plan drafts

**Files:**

- Create: `web/components/guidance/guidance-overview.tsx`
- Create: `web/components/guidance/guidance-overview.test.tsx`
- Create: `web/components/guidance/plan-builder.tsx`
- Create: `web/components/guidance/plan-builder.test.tsx`
- Create: `web/components/guidance/plan-item-dialog.tsx`

**Produces:** Overview conversation, starter actions, inline wizard, save-one/add-all.

- [ ] **Step 1: Write plan-builder tests** for form serialization, loading/error states,
  typed checklist rendering, saving one item, add-all confirmation, and skipping duplicates
  returned by the API.
- [ ] **Step 2: Extract the existing wizard form logic** from `guidance/page.tsx` into
  `PlanBuilder`. Remove the Cross-border checkbox; the builder calls `/guidance/wizard` with
  `create_reminders: false` and uses returned item domains.
- [ ] **Step 3: Implement `PlanItemDialog`.** Accept a prefilled draft, allow title,
  rationale, domain, and due date edits, and call `useCreatePlanItem`. Dialog must label title
  and description and restore focus on close.
- [ ] **Step 4: Implement save-one/add-all.** Add-all uses one confirmation dialog, then
  executes creates sequentially or with bounded `Promise.all` over the returned checklist.
  Report added vs already-existing counts in one toast.
- [ ] **Step 5: Write Overview tests** proving starter actions submit the right prompt,
  “Build my guidance plan” opens the inline builder, and open-plan preview links to
  `?section=plan`.
- [ ] **Step 6: Implement `GuidanceOverview`.** Desktop layout: conversation main column,
  plan preview side column. Mobile: conversation, plan preview, then builder when open.
  Starter actions use the agreed prompts from the design.
- [ ] **Step 7: Run tests and typecheck.**

  ```bash
  cd web
  npx vitest run components/guidance/plan-builder.test.tsx components/guidance/guidance-overview.test.tsx
  npx tsc --noEmit
  ```

- [ ] **Step 8: Commit.**

  ```bash
  git add web/components/guidance/guidance-overview.tsx web/components/guidance/guidance-overview.test.tsx web/components/guidance/plan-builder.tsx web/components/guidance/plan-builder.test.tsx web/components/guidance/plan-item-dialog.tsx
  git commit -m "feat(web): turn guidance wizard into saved plans"
  ```

---

## Task 8: Build My Plan as the persistent outcome

**Files:**

- Create: `web/components/guidance/plan-list.tsx`
- Create: `web/components/guidance/plan-list.test.tsx`
- Modify: `web/app/(app)/guidance/page.tsx`

**Produces:** list/filter/edit/complete/reopen/dismiss experience.

- [ ] **Step 1: Write plan-list tests** for loading, empty, open-first rendering, domain/date
  labels, filter changes, complete, reopen, edit, dismiss, and mutation failure.
- [ ] **Step 2: Implement filters** for Open, Completed, and Dismissed. Keep filter state in
  component state; section remains URL-addressable without encoding every status filter.
- [ ] **Step 3: Implement rows.** Show title, rationale, domain, due date, source count, and
  source links. Actions are explicit text/icon buttons with accessible names.
- [ ] **Step 4: Implement mutations.** Use `useUpdatePlanItem`; invalidate the plan prefix on
  success. Do not optimistically remove rows unless rollback is covered by a test.
- [ ] **Step 5: Implement empty state.** Link to Overview and offer “Ask a question” and
  “Build my plan.”
- [ ] **Step 6: Wire My Plan into `guidance/page.tsx`** in place of its placeholder. Also wire
  Overview from T7. Keep Cross-border placeholder until T9.
- [ ] **Step 7: Run tests and typecheck.**

  ```bash
  cd web
  npx vitest run components/guidance/plan-list.test.tsx
  npx tsc --noEmit
  ```

- [ ] **Step 8: Commit.**

  ```bash
  git add web/components/guidance/plan-list.tsx web/components/guidance/plan-list.test.tsx "web/app/(app)/guidance/page.tsx"
  git commit -m "feat(web): add persistent guidance plan"
  ```

---

## Task 9: Compose Cross-border conversation, transfers, limits, and plan saves

**Files:**

- Create: `web/components/guidance/cross-border-guidance.tsx`
- Create: `web/components/guidance/cross-border-guidance.test.tsx`
- Modify: `web/components/guidance/cross-border-module.tsx`
- Create: `web/components/guidance/cross-border-module.test.tsx`
- Modify: `web/app/(app)/guidance/page.tsx`

**Produces:** first-class Cross-border section inside Guidance.

- [ ] **Step 1: Add transfer invalidation UI test** proving a successful create refreshes
  both transfer and limit queries through the hook behavior introduced in T4.
- [ ] **Step 2: Refactor `CrossBorderModule`** to render explicit retry states for transfers
  and limits. Add optional:

  ```ts
  onSaveWarning?: (warning: Record<string, unknown>, citations: Citation[]) => void
  ```

  Warning Save action creates a `cross_border` plan draft; the module does not call plan hooks.
- [ ] **Step 3: Write Cross-border composition tests** proving:
  - shared conversation receives `domain="cross_border"` and thread `cross-border`;
  - starter prompts are cross-border-specific;
  - transfers and limits render below/beside the conversation;
  - saving an answer or warning opens the same plan-item dialog;
  - no “Cross-border specialised” checkbox exists.
- [ ] **Step 4: Implement `CrossBorderGuidance`.** Wide layout uses conversation and tools
  columns; narrow layout stacks conversation then tools. Add a compact summary from limits:
  highest warning if present, otherwise a neutral “No current corpus-defined warning.”
- [ ] **Step 5: Replace the Cross-border placeholder** in `guidance/page.tsx`.
- [ ] **Step 6: Run tests and typecheck.**

  ```bash
  cd web
  npx vitest run components/guidance/cross-border-module.test.tsx components/guidance/cross-border-guidance.test.tsx
  npx tsc --noEmit
  ```

- [ ] **Step 7: Commit.**

  ```bash
  git add web/components/guidance/cross-border-guidance.tsx web/components/guidance/cross-border-guidance.test.tsx web/components/guidance/cross-border-module.tsx web/components/guidance/cross-border-module.test.tsx "web/app/(app)/guidance/page.tsx"
  git commit -m "feat(web): integrate cross-border into guidance"
  ```

---

## Task 10: End-to-end coverage, compatibility, and closeout

**Files:**

- Modify: `web/e2e/w3.spec.ts`
- Modify: `web/e2e/redesign-surfaces.spec.ts` only if tab labels are asserted there
- Modify: `web/REBUILD_PROGRESS.md`
- Modify: affected tests discovered by the old Ask/Plan labels

- [ ] **Step 1: Replace old Guidance E2E assertions.** Cover:
  1. Overview/Cross-border/My Plan tabs visible.
  2. Ask a seeded-corpus question and see a source type/date.
  3. Save answer, open My Plan, mark complete.
  4. Open Cross-border, log a transfer, and see transfers/limits remain present.
  5. Build checklist and save one item.
  6. Navigate to `/guidance?tab=plan` and verify My Plan.
- [ ] **Step 2: Scan for stale navigation assumptions.** Run:

  ```bash
  rg -n 'Ask.*Plan|tab=plan|Cross-border specialised|switches between ask' web docs/superpowers -g '*.ts' -g '*.tsx' -g '*.md'
  ```

  Update active tests/docs. Do not rewrite historical specs/plans; only mark the new design as
  superseding their Guidance IA decision where useful.
- [ ] **Step 3: Update progress tracker.** Keep Guidance status `done`, but change its outcome
  to `unified conversation + persistent plan + nested cross-border transfers/limits` and link
  the new spec/plan in W3 notes.
- [ ] **Step 4: Run backend focused and full suites.**

  ```bash
  docker compose exec api pytest -q tests/test_m10_guidance.py tests/test_m30_guidance_plan.py
  docker compose exec api pytest -q
  ```

  Expected: pass or pre-existing unrelated failures documented with evidence.
- [ ] **Step 5: Run frontend unit, typecheck, and build.**

  ```bash
  cd web
  npx vitest run
  npx tsc --noEmit
  npm run build
  ```

  Expected: pass.
- [ ] **Step 6: Run Guidance Playwright.** With API/web and seeded test data running:

  ```bash
  cd web
  npx playwright test e2e/w3.spec.ts
  ```

  Expected: pass.
- [ ] **Step 7: Manual responsive/accessibility smoke.** Verify mobile and desktop widths,
  keyboard navigation through tabs/composer/dialog/plan actions, focus return, and source
  labels without relying on color.
- [ ] **Step 8: Commit closeout.**

  ```bash
  git add web/e2e/w3.spec.ts web/e2e/redesign-surfaces.spec.ts web/REBUILD_PROGRESS.md
  git commit -m "test(guidance): cover unified workspace"
  ```

---

## Execution checkpoints

### Checkpoint A — walking skeleton complete

After T1, T2, plan hooks from T4, and T8:

- a plan item can be created through the typed client;
- it appears in My Plan;
- it can be completed;
- another user cannot see it.

If this fails, stop and fix persistence/isolation before continuing with conversation UI.

### Checkpoint B — trust path complete

After T3 and T6:

- follow-up questions have context;
- every persisted answer recovers its citations after reload;
- no-doc and LLM-down behavior is explicit and non-throwing.

If citations cannot survive thread reload, do not ship conversation persistence.

### Checkpoint C — unified product complete

After T7–T9:

- Ask is no longer a top tab;
- Plan is a saved artifact, not a duplicate form;
- Cross-border is directly visible inside Guidance;
- the same conversation model works in Overview and Cross-border.

## Re-plan triggers

Re-plan the remaining work immediately if any of these occur:

- generated OpenAPI types require a breaking change to an existing endpoint;
- conversation payload storage needs a new table rather than the additive JSONB column;
- plan isolation conflicts with an explicit household-sharing requirement;
- existing notification side effects cannot be separated from wizard generation safely;
- the Guidance component test setup requires more than one new testing dependency (dependencies
  are forbidden; choose a simpler component boundary instead);
- focused tasks take more than twice their planned task boundary because current code differs
  materially from the audited state.

## Final acceptance checklist

- [ ] `/guidance` renders Overview with shared cited conversation.
- [ ] `/guidance?section=cross-border` renders conversation + transfers + limits.
- [ ] `/guidance?section=plan` renders persistent user-owned plan items.
- [ ] Legacy `/guidance?tab=plan` renders My Plan.
- [ ] Drawer Cross-border entry deep-links to the correct Guidance section.
- [ ] No Cross-border checkbox remains.
- [ ] Wizard suggestions can be saved individually or in a confirmed batch.
- [ ] Answers and warnings can be saved explicitly to My Plan.
- [ ] Plan items support edit, complete, reopen, dismiss, filter, and source display.
- [ ] Conversation history survives reload with citations.
- [ ] Transfer creation refreshes both transfers and limits.
- [ ] No-doc and LLM-unavailable paths remain usable.
- [ ] User/household isolation tests pass.
- [ ] Generated schema, typecheck, unit tests, build, and Playwright pass.
- [ ] No native iOS files or live market-data features were added in this slice.
