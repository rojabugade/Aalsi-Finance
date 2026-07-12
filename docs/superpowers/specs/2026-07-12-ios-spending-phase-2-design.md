# iOS Spending Phase 2 — Design Spec

Date: 2026-07-12

Status: Approved design; pending implementation plan

Audience: Engineers implementing and reviewing the iOS Spending redesign

Owner: Aalsi Finance

## Decision

Phase 2 will replace the basic iOS Activity screen with a **mobile-native Spending experience that reaches functional parity with the web Spend surface**. The iOS information architecture will be **Overview · Activity · Recurring** rather than copying the web tabs. Existing backend contracts remain the source of truth; pure spend derivations will live in `AalsiFinanceKit`.

This spec covers Spending only. Budgets, which the parent redesign grouped into Phase 2, will receive a separate design and implementation cycle.

## Outcome

A user can understand the selected month's spend, find what changed, explore category/subcategory/merchant/item detail, manage transactions through their full lifecycle, review recurring obligations, merge transactions, and export the filtered ledger without leaving the iOS app.

Success means the iOS surface supports the useful union of the current and classic web Spend experiences while remaining legible and native on a phone.

## Context

The approved parent spec, `docs/superpowers/specs/2026-07-12-ios-app-ux-redesign-design.md`, originally defined four Spending pills: Activity, Categories, Merchants, and Recurring. Brainstorming for Phase 2 changed that hierarchy:

- Overview is the default and combines a compact month pulse with a deterministic explanation of what changed.
- Activity is one unified scroll. Categories, subcategories, merchants, items, filters, and the ledger coexist without separate top-level category or merchant pills.
- Recurring remains a third pill because it is forward-looking rather than another historical ledger grouping.
- Item and receipt-line intelligence is no longer deferred. It appears in transaction and drill contexts without gaining another pill.
- Functional parity includes transaction creation, editing, confirmation, splitting, deletion, merging, and filtered CSV export.

The existing iOS app already provides a day-grouped `ActivityView`, transaction detail and confirmation, transaction/category loading, and a Phase 1 shell with `AppHeader`, `PillNav`, `AppTheme`, and shared money formatting. Phase 2 extends those foundations instead of creating a parallel stack.

## Chosen approach: adapt capability, not desktop layout

The chosen approach preserves the complete workflow but reorganizes it for mobile. `SpendingView` becomes the feature root, one `SpendingViewModel` owns the shared snapshot and interaction state, and native navigation destinations provide depth.

Two alternatives were rejected:

1. **Literal web port.** Copying Transactions · Merchants · Items · Recurring would make capability comparison easy but contradict the approved three-pill mobile hierarchy and fragment the main review flow.
2. **New server-composed Spend API.** Aggregate endpoints could make the client thinner, but existing endpoints already expose the required data. Adding backend contracts would increase Phase 2 scope without unlocking a required behavior.

Revisit the server-composed option only if measured launch or refresh performance shows that the current parallel requests and client derivations cannot meet an acceptable mobile experience.

## Information architecture

`SpendingView` owns a `NavigationStack` and renders the persistent app header, the page title, the page-specific add action, and the three-pill selector.

### Overview is the default comprehension surface

Overview answers two questions in the first viewport: “How much have I spent?” and “What changed?” Its order is:

1. Month selector with previous/next controls. Future months are disabled.
2. Compact pulse card: total spend, transaction count, period delta, cumulative daily trend, and daily pace.
3. One deterministic insight explaining the strongest change.
4. Compact leading-category and leading-merchant summaries.
5. Ranked category and merchant previews with drill actions.

The pulse follows the selected month. For the current month, comparisons use the same number of elapsed days in the prior month. Completed months compare full month to full prior month. This prevents a partial current month from being compared with a complete prior month.

The insight never invents a cause and does not require an LLM. Selection priority is:

1. category with the largest positive spend delta;
2. merchant with the largest positive spend delta;
3. largest purchase in the selected period when prior-period evidence is unavailable;
4. a neutral pace statement when none of the above is meaningful.

Insight copy states only calculated facts, such as the amount of change and the transactions or merchant that contribute to it. Tapping the insight opens the matching category, merchant, or transaction drill.

### Activity is one unified exploration scroll

Activity does not contain a second segmented navigation system. Its scroll order is:

1. selected-month summary;
2. search and filter entry;
3. active removable filter chips;
4. compact category summary with ranked preview and “View all” drill;
5. compact merchant summary with ranked preview and “View all” drill;
6. day-grouped transaction ledger.

Each transaction row shows merchant, category → subcategory path when known, time/date, status when actionable, and signed amount. Drafts remain visually distinct and retain the existing confirm gesture/action.

Category selection opens a category drill. A parent category drill shows its total, prior-period delta, subcategories, top merchants, and matching transactions. Selecting a subcategory reuses the same drill shape, scoped to that node.

Merchant selection opens a merchant drill with period total, visit count, average purchase, delta, dominant category, category mix, recurring status, top receipt-line products, and matching transactions.

Item intelligence has no top-level destination. Receipt line items appear in transaction detail, merchant drill, and search results when data exists. Empty item sections invite receipt capture/import and never fabricate product data.

### Recurring remains a separate forward-looking surface

Recurring shows:

- monthly commitment total;
- canonical active recurring series, including cadence and next charge when supplied;
- merchant cadence patterns detected from transactions spanning at least three distinct months;
- links into recurring-series or merchant detail.

Canonical series win over inferred patterns. A merchant already represented by a canonical series is excluded from the inferred list and total so obligations are not double-counted. Recurring does not inherit the Overview/Activity month filter.

## Navigation model

Top-level pill and month/filter state remain owned by `SpendingViewModel`. Feature depth uses typed `NavigationStack` destinations:

```text
Overview / Activity
  ├─ Category → Subcategory → Transaction
  ├─ Merchant → Category mix / Items → Transaction
  └─ Transaction → View / Edit / Split / Confirm / Delete

Recurring
  ├─ Recurring series detail
  └─ Merchant drill
```

Moving between Overview and Activity retains the selected month. Pull-to-refresh retains the selected pill, month, filters, selection mode, and active navigation path while replacing the underlying snapshot.

## Component boundaries

Each unit has one primary responsibility:

| Unit | Responsibility | Depends on |
|---|---|---|
| `SpendingView` | Feature navigation, header, pills, sheets, typed destinations | `SpendingViewModel`, Phase 1 chrome |
| `SpendingViewModel` | Load shared data, retain UI state, run mutations, publish immutable snapshot | `APIClient`, `AalsiFinanceKit` derivations |
| `SpendingOverview` | Render pulse, insight, and ranked previews | Derived overview view model |
| `SpendingActivity` | Render unified filters, summaries, selection mode, and ledger | Derived activity view model |
| `SpendingRecurring` | Render canonical and inferred recurring obligations | Derived recurring view model |
| `CategoryDrillView` | Parent/subcategory summary and matching merchants/transactions | Category-scoped derivation |
| `MerchantDrillView` | Merchant summary, category mix, items, recurring state, transactions | Merchant-scoped derivation |
| `TransactionEditorView` | Create and edit transaction fields | Transaction mutation methods |
| `TransactionSplitView` | Maintain balanced split parts and submit them | Split validation and mutation |
| `SpendSummaryCard` | Reusable compact metric/pulse presentation | `AppTheme`, `Money` |
| `SpendFilterBar` | Search/filter sheet entry and active chip display | Filter value type |

The current `ActivityViewModel` loading, grouping, search, and confirmation behavior is absorbed into `SpendingViewModel`. `TransactionRow` remains a reusable presentation unit. Useful transaction-detail sections are retained, then extended for the parity workflow.

## Data flow and pure derivations

The initial load requests independent resources in parallel:

- `GET /transactions`
- `GET /categories`
- `GET /recurring-series?status=active`

Transactions and categories form the required core snapshot for Overview and Activity. Recurring-series failure is isolated to the Recurring pill. The view model publishes immutable derived values so SwiftUI views do not independently recalculate category trees, sign semantics, or filters.

Pure logic belongs in `AalsiFinanceKit` and includes:

- selected and comparable prior period ranges;
- signed spend, income, transfer, and refund classification;
- parent/subcategory resolution;
- cumulative daily series and daily pace;
- category and merchant totals, shares, counts, deltas, and ranking;
- largest-purchase and deterministic-insight selection;
- merchant category mix and receipt-line product totals;
- canonical/inferred recurring deduplication and monthly normalization;
- search and filter evaluation;
- merge eligibility and split balance validation.

Spend uses the web app's sign semantics. Negative categorized outflows contribute positive spend. Positive income and transfers do not. A transaction flagged as a refund reduces the corresponding category's spend. Every Overview, Activity, category, merchant, and export total must use the same classifier.

## Filters and selection

Activity supports the functional union of the web filters:

- merchant or notes search;
- category, including descendant subcategories;
- direction: all, spend, or income;
- amount band;
- recurring only;
- status: all, draft, or confirmed.

Filters open in a native sheet. Applied values return as removable chips above the summaries and ledger. All category, merchant, transaction-count, and export values in Activity use the same filtered set. Overview remains an unfiltered month-level summary.

An explicit Select action enters bulk mode. Two or more eligible transactions enable Merge. Leaving selection mode clears the selection but does not clear filters or change the month.

## Transaction lifecycle

The page-specific add button opens `TransactionEditorView` in create mode. The form supports:

- amount and direction;
- merchant;
- currency;
- transaction date;
- parent category or subcategory;
- status;
- notes.

Manual entries default to `draft` and `source_channel = manual`. The signed API amount is derived from direction rather than requiring the user to type a negative number.

Transaction detail supports:

- editing merchant, signed amount/direction, currency, date, category/subcategory, status, and notes;
- confirming a draft;
- splitting into two or more category amounts whose signed sum matches the source transaction;
- deleting after destructive confirmation;
- viewing line items, provenance, and recurring association when present.

Bulk merge uses the existing merge contract. The client rejects fewer than two selections before sending, disables conflicting actions while the request runs, and preserves the ledger context after refresh.

Filtered export produces CSV columns matching the web experience: date, merchant, category, amount, currency, status, and notes. The generated file opens in the native iOS share sheet.

## API and model changes

`APIClient` gains typed methods for:

- `POST /transactions`
- `PATCH /transactions/{id}`
- `POST /transactions/{id}/confirm`
- `POST /transactions/{id}/split`
- `POST /transactions/merge`
- `DELETE /transactions/{id}`

`AalsiFinanceKit` gains public request types for create, patch, split, and merge payloads. Its transaction response model expands to expose backend fields used by parity behavior, including payment method, recurring series, flags, provenance, and line-item classification where the API supplies them. Decimal strings, snake_case keys, naive datetimes, and date-only values continue to use the package's existing tolerant coding rules.

No backend schema or endpoint change is required by this design.

## Mutation and refresh behavior

Every mutation follows one flow:

1. validate locally;
2. disable conflicting controls while the request is in flight;
3. submit the typed payload;
4. show success feedback and refresh the shared snapshot;
5. preserve pill, month, filters, scroll identity, and navigation context.

Failed mutations keep user-entered form data and show an inline retryable error. Destructive actions never use optimistic deletion. A successful create inserts the returned transaction into the current snapshot immediately, then refreshes from the server as the authoritative source.

## Loading, failure, and empty states

- Overview, Activity summaries, and ledger use skeletons shaped like their final layout. There is no full-screen spinner.
- A transaction or category load failure blocks Overview and Activity with a retry state.
- A recurring-series failure affects only the Recurring pill.
- Activity distinguishes no data from no filter matches and offers a clear-filter action for the latter.
- Empty category/merchant summaries explain that confirmed categorized transactions are required.
- Empty item intelligence invites receipt capture/import.
- Empty Recurring distinguishes no canonical series from no inferred cadence pattern.
- Pull-to-refresh is available on every pill root.

## Visual and accessibility rules

- All accent styling comes from `AppTheme`; no new hardcoded accent color is permitted.
- Positive, negative, and warning colors retain their semantic Phase 1 roles.
- Money uses `MoneyText`, `Money.formatted`, or `Money.compact` with monospaced digits.
- Dense data uses flat elevated cards. Liquid Glass is not added to ledger rows or drill lists.
- The Overview pulse and first insight should fit in the first viewport at default Dynamic Type.
- VoiceOver row labels include merchant, category path, date, status, and signed amount.
- Delta and status meaning is expressed with text/iconography in addition to color.
- All controls meet minimum touch targets. Drill transitions respect Reduce Motion.

## Verification

### `AalsiFinanceKit` unit tests

- spend/income/transfer/refund sign handling;
- current, completed, and prior comparable month ranges;
- category hierarchy and descendant filtering;
- category and merchant totals, deltas, counts, and stable ordering;
- current-month partial comparison behavior;
- item aggregation and recurring deduplication;
- deterministic insight priority;
- filter combinations;
- split balance and merge eligibility;
- transaction create/patch/split/merge coding.

### App and ViewModel verification

- initial loading and isolated recurring failure;
- refresh preserving pill, month, filters, and path;
- successful and failed mutation behavior;
- selection-mode transitions;
- create/edit forms retaining values after failure;
- light, dark, empty, loading, and error previews for main components.

### Simulator smoke

Using the demo account and `AALSI_INITIAL_TAB=spending`, verify:

1. Overview month movement, pulse, insight, and drills.
2. Activity filters, category/subcategory and merchant drills, item visibility, and ledger detail.
3. Create, edit, confirm, split, delete, and refresh behavior.
4. Multi-select merge and filtered export through the share sheet.
5. Canonical and inferred recurring rows and merchant navigation.
6. Light/dark appearance and Dynamic Type at an accessibility size.

The implementation is complete only after `swift test --package-path ios/AalsiFinanceKit` passes, the iOS simulator build succeeds, and the smoke flows above pass without relying on invented demo values.

## Rollout and scope boundaries

Implementation keeps the existing `ActivityView` usable until the new feature root compiles and passes smoke verification. The final integration switches the Spending tab in `MainTabView` to `SpendingView`; unrelated Phase 1 screens remain untouched.

Explicitly out of scope:

- Budgets redesign and CRUD;
- AI-generated spend narratives;
- new backend aggregate endpoints;
- receipt capture/OCR implementation itself;
- editing recurring-series definitions;
- changes to web navigation or behavior.
