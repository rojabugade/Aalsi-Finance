# iOS Phase 3 — AI Advisor tab

Refines the AI-tab section of the approved 2026-07-12 UX redesign spec into a
buildable design. Goal stated by the user: the page must be *alluring* — the
screen people open on purpose, not the tab they forget exists. The lever for
that is not decoration; it is that the page always has something specific to
say about *your* money the moment it opens, and always offers a one-tap next
step.

## Scope

iOS app only (`ios/AalsiFinance`), branch `feat-kshitij-ios-app`. No backend
changes — every surface maps to existing endpoints. Home-screen wiring
("See why" → AI tab) is out of scope for this phase.

## Structure

`AdvisorView` replaces `AIPlaceholderView` behind the center AI tab.
In-page title "Advisor" via `AppHeader`. `PillNav`: **For you** | Plan |
Cross-border | Chat. DEBUG env hook `AALSI_INITIAL_AI_PILL=0..3` opens a pill
directly (same pattern as `AALSI_INITIAL_SPEND_PILL`).

## For you — the daily-habit surface

Ordered top to bottom:

1. **Today's brief** (glass hero, matching Home's `ForecastHeroCard`
   treatment). Time-of-day greeting caption, then a one-paragraph LLM brief:
   pace vs plan + the single action that matters today. Sourced from
   `POST /analyst/ask` (`mode: "explain"`, no `thread_id` so the chat thread
   stays clean, `page: "advisor"`), with a fixed prompt asking for ≤80 words
   grounded in numbers. **Cached per calendar day** in UserDefaults
   (`advisor.brief.<yyyy-MM-dd>` + stored text) so reopening the tab is
   instant and the LLM is hit at most once a day; pull-to-refresh forces a
   regenerate. While generating: redacted placeholder lines with a shimmer.
   If the analyst is unavailable (`available: false` or error): deterministic
   fallback sentence built from the cashflow summary (leftover + days left),
   so the hero never shows an error.
2. **Suggested question chips** (horizontal rail): 3–4 questions derived from
   live data — over-budget category, next upcoming EMI/bill, net-worth trend —
   with static fallbacks ("Where did my money go this week?", "How do I pay
   off my loans faster?"). Tapping switches to Chat and sends the question.
3. **Insights list**: active `analyst/monitor` alerts sorted by severity.
   Tone-mapped colors (positive → teal, info → accent, warning → amber,
   danger → pink). Each card: icon, title, detail, and a "Got it" control that
   `POST`s acknowledge and removes the row with a spring animation
   (optimistic; restored on failure). Empty state is a *positive* card ("All
   clear — nothing needs your attention"), not a void.
4. **"What your advisor knows"** trust row: compact footer ("Grounded in 73
   transactions, 4 budgets, 2 loans…") from `/analyst/memory/status`; tapping
   opens a sheet listing sources + last-synced. Builds the confidence that
   answers are about *their* data, which is what makes people ask.
5. **Docked ask bar** (safe-area inset bottom): "Ask anything about your
   money…" — submitting jumps to Chat and fires the question.

## Chat

- Thread key `ios-advisor` (any non-`guidance:*` key is valid; history via
  `GET /analyst/thread/ios-advisor/messages`, send via `POST /analyst/ask`
  with `thread_id`, `mode: "explain"`).
- User bubbles: accent capsules, right-aligned. Analyst bubbles: card surface,
  left-aligned, sparkles avatar. Naive linebreak-preserving text.
- Typing indicator (three pulsing dots) while awaiting the reply; send haptic
  on submit, soft haptic on reply.
- Empty thread shows a hero prompt + the same suggested-question chips.
- Failures append a retriable inline "Couldn't reach your advisor" row rather
  than an alert; the composed question is preserved.
- Auto-scrolls to the newest message; input bar pinned via safe-area inset.

## Plan

- `GET /guidance/plan-items` split into **Open** and **Done** (Done
  collapsed). Row: circle check button, title, optional rationale
  (expandable), due-date badge (overdue → pink), domain tag (investment /
  cross-border only; general untagged).
- Checking `PATCH`es `status: "completed"` optimistically with a spring
  strikethrough + success haptic; un-checking reopens.
- Empty state sells the feature: "No plan yet — ask your advisor to build
  one" with a button that jumps to Chat and sends a plan-building question
  (`mode: "plan"`).

## Cross-border

Read-first surface from three endpoints:

- **Limits** (`GET /cross-border/limits`): per-corridor transfer totals; any
  parsed limits as progress context; warnings rendered as amber cards.
- **Transfers** (`GET /cross-border/transfers`): direction, currency pair,
  amount, date rows.
- **Checklist** (`GET /cross-border/checklist`): title, topic, source link
  (opens in Safari), effective date.
- Disclaimer string rendered as a footnote. Wizard and transfer logging stay
  out of v1 (entry points can come later; nothing here blocks them).

## Data / decoding

New Kit file `AdvisorModels.swift` (all `Decodable`, snake_case + Decimal
strings + naive datetimes already absorbed by `JSONDecoder.api()`):
`AnalystAskOut` (+ `AnalystAction`, lenient `citations`),
`AnalystThreadMessage/Out`, `GuidancePlanItem`, `CrossBorderTransfer`,
`CrossBorderLimits` (totals/limits/warnings as loosely-typed rows),
`CrossBorderChecklist`, `MemoryStatus`. Fixture-based decoding tests in
`AdvisorModelsDecodingTests.swift` mirror real backend payload shapes.

`APIClient` additions: `analystAsk`, `analystThread`, `acknowledgeAlert`,
`planItems`, `updatePlanItemStatus`, `crossBorderLimits`,
`crossBorderTransfers`, `crossBorderChecklist`, `memoryStatus`.

## Files

- Kit: `Sources/AalsiFinanceKit/AdvisorModels.swift`,
  `Tests/AalsiFinanceKitTests/AdvisorModelsDecodingTests.swift`
- App: `Features/AI/AdvisorView.swift` (container + pills),
  `Features/AI/AdvisorViewModel.swift` (for-you state, brief cache, chips),
  `Features/AI/ForYouPane.swift`, `Features/AI/ChatPane.swift`,
  `Features/AI/PlanPane.swift`, `Features/AI/CrossBorderPane.swift`;
  `AIPlaceholderView.swift` deleted; `MainTabView` swaps in `AdvisorView`.

## Error handling

Every pane uses the existing `Loadable` + `ErrorStateView`/`LoadingCard`
pattern. LLM-dependent surfaces (brief, chat) degrade gracefully instead of
erroring: the brief falls back to a deterministic summary; chat shows an
inline retry row. Monitor/plan/cross-border are plain REST and use the
standard retry state.

## Testing

- Kit: decoding tests for every new model (swift test).
- App: `xcodebuild` for the app target; smoke via simulator screenshots using
  `AALSI_INITIAL_TAB=ai` + `AALSI_INITIAL_AI_PILL` with the demo account and
  the dockerized backend.
