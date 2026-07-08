# Debt Redesign — Phase 3: Persistent AI Coach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift analyst chat history out of per-component local state into a session-scoped thread store so threads persist across reopen, then add a polished, persistent **AI Coach** pane to the debt surfaces (overview + loan detail) backed by the Phase 0 debt-aware analyst.

**Architecture:** A module-singleton `thread-store.ts` (`useSyncExternalStore`, keyed by `threadId`, **not** persisted to localStorage) holds `ChatMessage[]` per thread. `ChatThread` is refactored to read/write the store via a `threadId` prop instead of `useState`, and gains an optional `preamble` prepended to outgoing questions (for loan-specific context). `ai-coach.tsx` composes a header, a "Top recommendation" card from `useDebtPlan`, and a persistent `ChatThread`. `debt-context.ts` reuses `loanContextPreamble` to inject loan facts on the detail page. Dashboard thread id = `"dashboard"`; overview coach = `"debt"`; loan coach = `"loan:<id>"`.

**Tech Stack:** React 19 `useSyncExternalStore`, React Query analyst hooks (`@/lib/api/analyst`), Tailwind CSS-var tokens, vitest + @testing-library/react.

## Global Constraints

- **Temporary memory only** — the store is a module singleton; it clears on full page reload. Do **not** write it to `localStorage`/`sessionStorage` (per spec §Out of scope: "durable analyst memory" is excluded).
- **Tokens, never hex.** Reuse the analyst vocabulary (`bg-card`, `border-border`, `text-muted`, `bg-accent`, `text-on-accent`, `bg-chip`, `rounded-chip`, `bg-accent-soft`).
- **Reuse, don't fork** — `ChatThread` stays the single chat component for both the dashboard pane and the coach. The AI Coach wraps it; it does not reimplement the composer/message rendering.
- **Honest AI labeling** — the "Top recommendation" card shows the LLM `narrative` only when `useDebtPlan().data.source === "ai"`; on `deterministic` it shows the deterministic headline with no "AI" claim.
- **Dependency:** this phase consumes `components/debt/overview/debt-overview.tsx` (Phase 1) and `components/debt/detail/loan-detail-page.tsx` (Phase 2). Execute after those exist. `components/debt/loan-context.ts` (`loanContextPreamble`) must still exist (Phase 2 keeps it).
- Gate on `npm run typecheck` and `npm run test:unit`.

---

### Task 1: Session-scoped thread store (`thread-store.ts`)

**Files:**
- Create: `web/components/dashboard/analyst/thread-store.ts`
- Test: `web/components/dashboard/analyst/thread-store.test.tsx`

**Interfaces:**
- Produces:
  - `type ChatMessage = { role: "user" | "analyst"; text: string; result?: AskOut }` (re-exported; `AskOut` from `@/lib/api/analyst`).
  - `function getThread(id: string): ChatMessage[]`
  - `function appendMessage(id: string, message: ChatMessage): void`
  - `function resetThread(id: string): void`
  - `function subscribe(listener: () => void): () => void`
  - `function useThread(id: string): ChatMessage[]`

- [ ] **Step 1: Write the failing tests**

Create `web/components/dashboard/analyst/thread-store.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendMessage, getThread, resetThread, useThread,
} from "./thread-store";

afterEach(() => {
  resetThread("a");
  resetThread("b");
});

describe("thread-store", () => {
  it("isolates messages per thread id", () => {
    appendMessage("a", { role: "user", text: "hi a" });
    appendMessage("b", { role: "user", text: "hi b" });
    expect(getThread("a")).toHaveLength(1);
    expect(getThread("a")[0].text).toBe("hi a");
    expect(getThread("b")[0].text).toBe("hi b");
  });

  it("returns a stable empty array for unknown threads", () => {
    expect(getThread("missing")).toEqual([]);
    expect(getThread("missing")).toBe(getThread("missing"));
  });

  it("resetThread clears a thread", () => {
    appendMessage("a", { role: "user", text: "hi" });
    resetThread("a");
    expect(getThread("a")).toHaveLength(0);
  });

  it("useThread re-renders subscribers on append and restores after remount", () => {
    function View() {
      const messages = useThread("a");
      return <div data-testid="count">{messages.length}</div>;
    }
    const { unmount } = render(<View />);
    expect(screen.getByTestId("count").textContent).toBe("0");
    act(() => appendMessage("a", { role: "user", text: "persisted" }));
    expect(screen.getByTestId("count").textContent).toBe("1");
    unmount();
    // Store survives unmount; a fresh mount reads the same thread.
    render(<View />);
    expect(screen.getByTestId("count").textContent).toBe("1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run components/dashboard/analyst/thread-store.test.tsx`
Expected: FAIL — cannot resolve `./thread-store`.

- [ ] **Step 3: Implement the store**

Create `web/components/dashboard/analyst/thread-store.ts`:

```ts
"use client";

import { useSyncExternalStore } from "react";
import type { AskOut } from "@/lib/api/analyst";

export type ChatMessage = { role: "user" | "analyst"; text: string; result?: AskOut };

const EMPTY: ChatMessage[] = [];
const threads = new Map<string, ChatMessage[]>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getThread(id: string): ChatMessage[] {
  return threads.get(id) ?? EMPTY;
}

export function appendMessage(id: string, message: ChatMessage): void {
  threads.set(id, [...getThread(id), message]);
  emit();
}

export function resetThread(id: string): void {
  if (threads.delete(id)) emit();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useThread(id: string): ChatMessage[] {
  return useSyncExternalStore(
    subscribe,
    () => getThread(id),
    () => getThread(id),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run components/dashboard/analyst/thread-store.test.tsx`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add web/components/dashboard/analyst/thread-store.ts web/components/dashboard/analyst/thread-store.test.tsx
git commit -m "feat(analyst): session-scoped chat thread store"
```

---

### Task 2: Refactor `ChatThread` onto the store (+ optional preamble)

**Files:**
- Modify: `web/components/dashboard/analyst/chat-thread.tsx`
- Modify: `web/components/dashboard/analyst/analyst-pane.tsx` (pass `threadId="dashboard"`)
- Modify: `web/components/dashboard/analyst/chat-thread.test.tsx` (add `threadId` to existing renders)
- Test: `web/components/dashboard/analyst/chat-thread-persist.test.tsx`

**Interfaces:**
- Consumes: `useThread`, `appendMessage`, `resetThread`, `type ChatMessage` from `./thread-store`.
- Produces: `function ChatThread({ mode, range, threadId, preamble }: { mode: Exclude<AnalystMode, "monitor">; range: DateRange; threadId: string; preamble?: string }): JSX.Element`. Messages come from `useThread(threadId)`; new messages via `appendMessage(threadId, …)`. When `preamble` is set, the question sent to the API is `` `${preamble}. ${value}` `` (the displayed user bubble still shows the raw `value`).

- [ ] **Step 1: Write the failing persistence test**

Create `web/components/dashboard/analyst/chat-thread-persist.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mutateAsync = vi.fn(async () => ({ answer: "Pay the card first.", available: true }));
vi.mock("@/lib/api/analyst", () => ({
  useAnalystAsk: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("./use-analyst", () => ({ useAnalyst: () => ({ runAction: vi.fn() }) }));

import { ChatThread } from "./chat-thread";
import { resetThread } from "./thread-store";

const range = { from: "2026-01-01", to: "2026-03-31" };
afterEach(() => resetThread("t1"));

describe("ChatThread persistence", () => {
  it("keeps messages in the store across unmount/remount", async () => {
    const { unmount } = render(<ChatThread mode="explain" range={range} threadId="t1" />);
    fireEvent.change(screen.getByPlaceholderText(/Ask the analyst/i), { target: { value: "What should I do?" } });
    fireEvent.submit(screen.getByTestId("analyst-composer"));
    await waitFor(() => expect(screen.getByText(/Pay the card first/)).toBeInTheDocument());
    unmount();
    render(<ChatThread mode="explain" range={range} threadId="t1" />);
    expect(screen.getByText(/Pay the card first/)).toBeInTheDocument();
    expect(screen.getByText(/What should I do\?/)).toBeInTheDocument();
  });

  it("prepends the preamble to the API question but shows the raw text", async () => {
    render(<ChatThread mode="explain" range={range} threadId="t1" preamble="Loan: Card (credit_card)" />);
    fireEvent.change(screen.getByPlaceholderText(/Ask the analyst/i), { target: { value: "How fast?" } });
    fireEvent.submit(screen.getByTestId("analyst-composer"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0][0].question).toBe("Loan: Card (credit_card). How fast?");
    expect(screen.getByText("How fast?")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/dashboard/analyst/chat-thread-persist.test.tsx`
Expected: FAIL — `ChatThread` has no `threadId` prop / messages reset on remount.

- [ ] **Step 3: Refactor `chat-thread.tsx`**

Apply these exact edits to `web/components/dashboard/analyst/chat-thread.tsx`:

1. Replace the `Message` type + its local state. Remove `type Message = …;` (line 16) and the import is now from the store. At the top imports add:

```tsx
import { appendMessage, useThread, type ChatMessage } from "./thread-store";
```

2. Change the signature and state:

```tsx
export function ChatThread({
  mode,
  range,
  threadId,
  preamble,
}: {
  mode: Exclude<AnalystMode, "monitor">;
  range: DateRange;
  threadId: string;
  preamble?: string;
}) {
  const { runAction } = useAnalyst();
  const ask = useAnalystAsk();
  const [input, setInput] = useState("");
  const messages = useThread(threadId);
```

3. Rewrite `submit` to write through the store and apply the preamble:

```tsx
  const submit = async (question: string) => {
    const value = question.trim();
    if (!value || ask.isPending) return;
    setInput("");
    appendMessage(threadId, { role: "user", text: value });
    try {
      const result = await ask.mutateAsync({
        mode,
        question: preamble ? `${preamble}. ${value}` : value,
        range_from: range.from,
        range_to: range.to,
      });
      appendMessage(threadId, { role: "analyst", text: result.answer, result });
    } catch {
      appendMessage(threadId, { role: "analyst", text: "Something went wrong. Try again." });
    }
  };
```

4. Replace every remaining `Message` type annotation with `ChatMessage` (the `messages.map((message, index) => …)` body is unchanged).

- [ ] **Step 4: Update the dashboard pane + existing test**

In `web/components/dashboard/analyst/analyst-pane.tsx`, change the render at line 121:

```tsx
          {mode === "monitor" ? <MonitorFeed range={range} /> : <ChatThread mode={mode} range={range} threadId="dashboard" />}
```

In `web/components/dashboard/analyst/chat-thread.test.tsx`, add `threadId="dashboard"` to each `<ChatThread … />` render (typecheck now requires the prop). If the existing suite asserts a fresh empty thread, add `import { resetThread } from "./thread-store";` and call `resetThread("dashboard")` in an `afterEach`.

- [ ] **Step 5: Run the persistence test + typecheck + analyst suite**

Run: `cd web && npx vitest run components/dashboard/analyst/chat-thread-persist.test.tsx`
Expected: PASS

Run: `cd web && npm run typecheck`
Expected: PASS

Run: `cd web && npx vitest run components/dashboard/analyst`
Expected: PASS (all analyst tests, including the updated `chat-thread.test.tsx`)

- [ ] **Step 6: Commit**

```bash
git add web/components/dashboard/analyst/chat-thread.tsx web/components/dashboard/analyst/analyst-pane.tsx web/components/dashboard/analyst/chat-thread.test.tsx web/components/dashboard/analyst/chat-thread-persist.test.tsx
git commit -m "feat(analyst): persist chat threads via thread store + optional preamble"
```

---

### Task 3: Debt coach context (`debt-context.ts`)

**Files:**
- Create: `web/components/debt/debt-context.ts`
- Test: `web/components/debt/debt-context.test.ts`

**Interfaces:**
- Consumes: `loanContextPreamble` from `./loan-context`; `type Loan` from `@/lib/api/loans`; `type DebtPlan` from `@/lib/api/analyst`.
- Produces: `function loanCoachPreamble(loan: Loan, plan?: DebtPlan | null): string` — the loan facts, plus the AI plan's strategy + recommended extra when a plan is supplied and `source === "ai"`.

- [ ] **Step 1: Write the failing test**

Create `web/components/debt/debt-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loanCoachPreamble } from "./debt-context";
import type { Loan } from "@/lib/api/loans";
import type { DebtPlan } from "@/lib/api/analyst";

const loan = {
  name: "Card", type: "credit_card", principal: 10000, outstanding_balance: 8000,
  currency: "USD", interest_rate: 18, min_or_emi_amount: 300, next_due_date: "2024-06-01",
} as unknown as Loan;

describe("loanCoachPreamble", () => {
  it("includes loan facts", () => {
    const text = loanCoachPreamble(loan);
    expect(text).toMatch(/Card/);
    expect(text).toMatch(/8000/);
  });
  it("adds the AI strategy when an AI plan is supplied", () => {
    const plan = { source: "ai", strategy: "avalanche", extra_monthly: "200" } as unknown as DebtPlan;
    const text = loanCoachPreamble(loan, plan);
    expect(text).toMatch(/avalanche/);
    expect(text).toMatch(/200/);
  });
  it("omits strategy for a deterministic plan", () => {
    const plan = { source: "deterministic", strategy: "snowball", extra_monthly: "100" } as unknown as DebtPlan;
    expect(loanCoachPreamble(loan, plan)).not.toMatch(/snowball/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/debt/debt-context.test.ts`
Expected: FAIL — cannot resolve `./debt-context`.

- [ ] **Step 3: Implement the helper**

Create `web/components/debt/debt-context.ts`:

```ts
import type { Loan } from "@/lib/api/loans";
import type { DebtPlan } from "@/lib/api/analyst";
import { loanContextPreamble } from "./loan-context";

export function loanCoachPreamble(loan: Loan, plan?: DebtPlan | null): string {
  const base = loanContextPreamble(loan);
  if (plan && plan.source === "ai") {
    return `${base}; Recommended strategy: ${plan.strategy}; suggested extra: ${plan.extra_monthly}`;
  }
  return base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/debt/debt-context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/debt/debt-context.ts web/components/debt/debt-context.test.ts
git commit -m "feat(debt): loan coach context preamble"
```

---

### Task 4: AI Coach pane (`ai-coach.tsx`)

**Files:**
- Create: `web/components/debt/analyst/ai-coach.tsx`
- Test: `web/components/debt/analyst/ai-coach.test.tsx`

**Interfaces:**
- Consumes: `ChatThread` from `@/components/dashboard/analyst/chat-thread`; `type DebtPlan` from `@/lib/api/analyst`; `type DateRange` from `@/lib/dates`; `Sparkles` from `lucide-react`.
- Produces: `function AiCoach({ threadId, range, plan, preamble }: { threadId: string; range: DateRange; plan?: DebtPlan | null; preamble?: string }): JSX.Element` — header ("AI Coach" + BETA chip), a "Top recommendation" card (AI narrative/headline + strategy when `plan.source === "ai"`, deterministic headline otherwise), the persistent `ChatThread` (`mode="explain"`), and an "AI responses can make mistakes" footnote.

- [ ] **Step 1: Write the failing test**

Create `web/components/debt/analyst/ai-coach.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/dashboard/analyst/chat-thread", () => ({
  ChatThread: ({ threadId }: { threadId: string }) => <div data-testid="thread">{threadId}</div>,
}));

import { AiCoach } from "./ai-coach";
import type { DebtPlan } from "@/lib/api/analyst";

const range = { from: "2026-01-01", to: "2026-03-31" };

describe("AiCoach", () => {
  it("shows BETA, the AI recommendation, and the persistent thread", () => {
    const plan = { source: "ai", strategy: "avalanche", headline: "Hit the card", narrative: "Because 18% APR." } as unknown as DebtPlan;
    render(<AiCoach threadId="loan:card" range={range} plan={plan} />);
    expect(screen.getByText(/AI Coach/i)).toBeInTheDocument();
    expect(screen.getByText(/BETA/)).toBeInTheDocument();
    expect(screen.getByText(/Because 18% APR/)).toBeInTheDocument();
    expect(screen.getByTestId("thread").textContent).toBe("loan:card");
  });
  it("drops the AI narrative for a deterministic plan", () => {
    const plan = { source: "deterministic", strategy: "snowball", headline: "Pay smallest first", narrative: "" } as unknown as DebtPlan;
    render(<AiCoach threadId="debt" range={range} plan={plan} />);
    expect(screen.getByText(/Pay smallest first/)).toBeInTheDocument();
    expect(screen.queryByText(/mistakes/i)).toBeInTheDocument(); // footnote still present
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/debt/analyst/ai-coach.test.tsx`
Expected: FAIL — cannot resolve `./ai-coach`.

- [ ] **Step 3: Implement the component**

Create `web/components/debt/analyst/ai-coach.tsx`:

```tsx
"use client";

import { Sparkles } from "lucide-react";
import type { DateRange } from "@/lib/dates";
import type { DebtPlan } from "@/lib/api/analyst";
import { ChatThread } from "@/components/dashboard/analyst/chat-thread";

export function AiCoach({
  threadId,
  range,
  plan,
  preamble,
}: {
  threadId: string;
  range: DateRange;
  plan?: DebtPlan | null;
  preamble?: string;
}) {
  const isAi = plan?.source === "ai";

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-card-sm border border-border bg-card shadow-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="inline-flex items-center gap-2 text-sm font-bold">
          <Sparkles className="size-4 text-accent" /> AI Coach
        </span>
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">BETA</span>
      </header>

      {plan && (
        <div className="border-b border-border bg-chip/40 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {isAi ? "Top recommendation" : "Recommended plan"}
          </p>
          <p className="mt-1 text-sm font-medium">{plan.headline}</p>
          {isAi && plan.narrative && (
            <p className="mt-1 text-xs text-muted">{plan.narrative}</p>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1">
        <ChatThread mode="explain" range={range} threadId={threadId} preamble={preamble} />
      </div>

      <p className="border-t border-border px-4 py-2 text-[11px] text-muted">
        AI responses can make mistakes — verify important numbers.
      </p>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/debt/analyst/ai-coach.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/components/debt/analyst/ai-coach.tsx web/components/debt/analyst/ai-coach.test.tsx
git commit -m "feat(debt): persistent AI Coach pane"
```

---

### Task 5: Wire the coach into the debt surfaces

**Files:**
- Modify: `web/components/debt/overview/debt-overview.tsx` (Phase 1)
- Modify: `web/components/debt/detail/loan-detail-page.tsx` (Phase 2)

**Interfaces:**
- Consumes: `AiCoach` from `@/components/debt/analyst/ai-coach`; `loanCoachPreamble` from `@/components/debt/debt-context`; a `DateRange` (use the app's current range source, or a fixed last-90-days fallback consistent with the analyst default — see note).
- Produces: overview renders `<AiCoach threadId="debt" … plan={plan.data} />`; detail renders `<AiCoach threadId={`loan:${loan.id}`} … preamble={loanCoachPreamble(loan, plan)} />`.

Note on `range`: the debt-aware snapshot is range-driven on the backend, but the coach is debt-focused. Use the same default window the analyst uses when none is supplied. Reuse the existing helper if present (`grep -rn "useAnalyst\|DateRange\|defaultRange\|last90" web/lib web/components/dashboard/analyst`); otherwise pass `{ from, to }` for the trailing 90 days computed inline. Pick the existing source if one exists to stay DRY.

- [ ] **Step 1: Write the failing test**

Add to `web/components/debt/overview/debt-overview.test.tsx` (extend the existing Phase 1 suite). Mock the coach to keep it light:

```tsx
vi.mock("@/components/debt/analyst/ai-coach", () => ({
  AiCoach: ({ threadId }: { threadId: string }) => <div data-testid="coach">{threadId}</div>,
}));
```

…and in the "renders the surfaces" test add:

```tsx
    expect(screen.getByTestId("coach").textContent).toBe("debt");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/debt/overview/debt-overview.test.tsx`
Expected: FAIL — no `coach` test id (AiCoach not yet rendered).

- [ ] **Step 3: Add the coach to the overview**

In `web/components/debt/overview/debt-overview.tsx`, import and render the coach in the right-hand column (alongside `NextBestStep`/`DebtList`). Add the import:

```tsx
import { AiCoach } from "@/components/debt/analyst/ai-coach";
```

Determine the range once near the top of the component (reuse the project's range source per the Note; inline 90-day fallback shown here):

```tsx
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate()).toISOString().slice(0, 10);
  const range = { from, to };
```

Render it in the side column (e.g. above `DebtList`):

```tsx
      <div className="space-y-4">
        {plan.data && !stepDismissed && (
          <NextBestStep plan={plan.data} onDismiss={() => setStepDismissed(true)} />
        )}
        <div className="h-[420px]">
          <AiCoach threadId="debt" range={range} plan={plan.data} />
        </div>
        <DebtList loans={loans} />
      </div>
```

- [ ] **Step 4: Add the coach to the detail page**

In `web/components/debt/detail/loan-detail-page.tsx`, import the coach + context + the plan hook, and render the coach in the side column under `LoanInfoCard`:

```tsx
import { useDebtPlan } from "@/lib/api/analyst";
import { AiCoach } from "@/components/debt/analyst/ai-coach";
import { loanCoachPreamble } from "@/components/debt/debt-context";
```

Inside `LoanDetailPage` (non-editing branch side column):

```tsx
          <div className="space-y-4">
            <LoanInfoCard loan={loan} />
            <div className="h-[420px]">
              <AiCoach
                threadId={`loan:${loan.id}`}
                range={range}
                plan={plan.data}
                preamble={loanCoachPreamble(loan, plan.data)}
              />
            </div>
          </div>
```

Add the plan hook + range near the top of `LoanDetailPage`:

```tsx
  const plan = useDebtPlan();
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate()).toISOString().slice(0, 10);
  const range = { from, to };
```

(Update the Phase 2 `loan-detail-page.test.tsx` to mock `@/lib/api/analyst`'s `useDebtPlan` → `{ data: null }` and mock `@/components/debt/analyst/ai-coach` so the existing test stays light.)

- [ ] **Step 5: Run tests + typecheck + full suite**

Run: `cd web && npx vitest run components/debt/overview/debt-overview.test.tsx components/debt/detail/loan-detail-page.test.tsx`
Expected: PASS

Run: `cd web && npm run typecheck`
Expected: PASS

Run: `cd web && npm run test:unit`
Expected: PASS (all)

- [ ] **Step 6: Commit**

```bash
git add web/components/debt/overview/debt-overview.tsx web/components/debt/detail/loan-detail-page.tsx web/components/debt/overview/debt-overview.test.tsx web/components/debt/detail/loan-detail-page.test.tsx
git commit -m "feat(debt): wire persistent AI Coach into overview + loan detail"
```

---

## Self-Review

**Spec coverage (design §"Phase 3 — Persistent AI Coach"):**
- `thread-store.ts`: session-scoped, module singleton + `useSyncExternalStore`, `threadId → Message[]`, **not** localStorage → Task 1. ✓
- `ChatThread` takes a `threadId` and reads/writes the store instead of local `useState`; dashboard thread = `"dashboard"`; reopening restores → Task 2. ✓
- `ai-coach.tsx`: header "AI Coach" + BETA chip, suggested prompts (via reused `ChatThread`), "Top recommendation" from `useDebtPlan` (AI narrative + strategy), scrollable thread, composer, "AI responses can make mistakes" footnote → Task 4. ✓
- Detail-page coach injects loan facts via `debt-context.ts` (reusing `loanContextPreamble`) so answers are loan-specific → Tasks 3, 5. ✓
- Overview coach is debt-aware without extra injection because the snapshot now carries `loans` (Phase 0) → Task 5 (overview passes no `preamble`). ✓
- Wired into both the dashboard (persistence) and the debt surfaces → Tasks 2, 5. ✓

**Placeholder scan:** none — every code step has full content; the one open choice (the `range` source) is bounded with an explicit, working inline fallback and a `grep` to prefer an existing helper (DRY), not a "TODO".

**Type consistency:** `ChatMessage` defined in Task 1 is the only message type; Task 2 imports it and drops the local `Message`. `ChatThread`'s new signature `{ mode, range, threadId, preamble? }` is used identically by `analyst-pane.tsx` (Task 2, `threadId="dashboard"`, no preamble) and `ai-coach.tsx` (Task 4, with `preamble`). `AiCoach({ threadId, range, plan, preamble })` matches both call sites in Task 5. `loanCoachPreamble(loan, plan?)` signature matches Task 3 definition and Task 5 detail-page usage. `DebtPlan` field reads (`source`, `strategy`, `extra_monthly`, `headline`, `narrative`) match the Phase 0 schema.

**Decisions flagged:**
- **liquid-glass reuse:** the spec says the coach "reuses the liquid-glass treatment from `analyst-pane.tsx`." That effect (`liquidGL` + `#analyst-liquid-glass` + a full-`body` html2canvas snapshot) is purpose-built for the *floating* dialog and composites the page behind it; an inline, in-column coach card is a different integration. This plan ships the coach as a polished card in the same token vocabulary and defers the literal refraction layer. If the floating-glass look is required on the coach, it's a follow-up that wraps `AiCoach` in the `analyst-liquid-glass` container and runs `loadLiquidGL` — out of scope here to keep Phase 3 testable and shippable.
- **range source:** kept DRY by preferring an existing project range helper; the inline trailing-90-day fallback matches the analyst's `_default_from` (3 months back) on the backend.

**Risk note:** `useSyncExternalStore`'s `getSnapshot` returns the stored array reference (or a shared `EMPTY`), so it's referentially stable between renders when unchanged — avoiding the infinite-loop pitfall. The store is intentionally process-memory only; a hard reload clears it, exactly as the spec requires ("clears on full reload").
