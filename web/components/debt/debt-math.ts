export type LoanLike = {
  id: string;
  name: string;
  outstanding_balance?: number | string | null;
  principal: number | string;
  interest_rate?: number | string | null;
  min_or_emi_amount?: number | string | null;
  currency?: string | null;
  // Optional payoff-sim inputs (parity with backend app/analyst/debt_plan.py):
  schedule_kind?: string | null; // "revolving" cards get a dynamic %-of-balance min
  promo_rate?: number | string | null; // intro APR (annual %), in force until expiry
  promo_expiry_date?: string | null; // ISO date the promo rate reverts to interest_rate
  projected_monthly_spend?: number | string | null; // new charges/mo on a revolving card
};

const MONTH_CAP = 600;
// Revolving cards recompute their minimum as ~2% of the live balance each month
// (floored at the stated minimum). Matches _REVOLVING_MIN_PCT in the backend sim.
const REVOLVING_MIN_PCT = 0.02;

export function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function outstandingOf(loan: LoanLike): number {
  return num(loan.outstanding_balance ?? loan.principal);
}

function paymentOf(loan: LoanLike): number {
  const min = num(loan.min_or_emi_amount);
  // Fallback to 2% of outstanding so a payment-less loan still terminates. This is
  // the floor; revolving loans lift it to a % of the live balance each month.
  return min > 0 ? min : Math.max(1, outstandingOf(loan) * 0.02);
}

function isRevolving(loan: LoanLike): boolean {
  return loan.schedule_kind === "revolving";
}

// Intro-APR monthly rate, or null when the loan carries no promo.
function promoMonthlyRate(loan: LoanLike): number | null {
  if (loan.promo_rate === null || loan.promo_rate === undefined) return null;
  return num(loan.promo_rate) / 100 / 12;
}

// Months from today the promo rate stays in effect. Sim month N is "promo" while
// N <= this value; 0 means no active promo.
function promoUntilMonth(loan: LoanLike, today: Date): number {
  if (loan.promo_rate === null || loan.promo_rate === undefined) return 0;
  if (!loan.promo_expiry_date) return 0;
  const expiry = new Date(loan.promo_expiry_date);
  if (Number.isNaN(expiry.getTime())) return 0;
  const months =
    (expiry.getFullYear() - today.getFullYear()) * 12 +
    (expiry.getMonth() - today.getMonth());
  return Math.max(0, months);
}

// New charges assumed each month on a revolving card (0 unless provided), so sims
// stay optimistic by default and only model "you keep charging" when asked.
function projectedSpend(loan: LoanLike): number {
  if (!isRevolving(loan)) return 0;
  return Math.max(0, num(loan.projected_monthly_spend));
}

export function orderLoans(
  loans: LoanLike[],
  strategy: "snowball" | "avalanche",
): LoanLike[] {
  const copy = [...loans];
  if (strategy === "avalanche") {
    return copy.sort(
      (a, b) =>
        num(b.interest_rate) - num(a.interest_rate) ||
        outstandingOf(a) - outstandingOf(b),
    );
  }
  return copy.sort(
    (a, b) =>
      outstandingOf(a) - outstandingOf(b) ||
      num(b.interest_rate) - num(a.interest_rate),
  );
}

export function amortize(
  balance: number,
  annualRatePct: number,
  monthlyPayment: number,
): { months: number; totalInterest: number; totalPaid: number; series: number[]; neverPaysOff: boolean } {
  const rate = annualRatePct / 100 / 12;
  let bal = Math.max(0, balance);
  const series: number[] = [];
  let totalInterest = 0;
  let totalPaid = 0;
  if (bal > 0 && monthlyPayment <= bal * rate) {
    return { months: 0, totalInterest: 0, totalPaid: 0, series: [bal], neverPaysOff: true };
  }
  let months = 0;
  for (let i = 0; i < MONTH_CAP && bal > 0; i++) {
    const interest = bal * rate;
    const principal = Math.min(bal, monthlyPayment - interest);
    bal = Math.round((bal - principal) * 100) / 100;
    totalInterest += interest;
    totalPaid += principal + interest;
    months += 1;
    series.push(bal);
  }
  return {
    months,
    totalInterest: Math.round(totalInterest * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    series,
    neverPaysOff: false,
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Avalanche/snowball concentrate the extra on one account at a time; "even"
// splits it proportionally across every account each month.
export type PayoffMethod = "snowball" | "avalanche" | "even";

// How the extra (plus any rolled-over cash) lands on a single account in a month.
export type Allocation = {
  id: string;
  name: string;
  minimum: number; // the account's own minimum due this month
  extra: number; // share of the extra/rollover pool applied on top of the minimum
  total: number; // minimum + extra
  isTarget: boolean; // received any of the extra pool
  clears: boolean; // this month's payment pays the account off
};

// When each account starts getting the extra and when it is paid off — the
// "story" of how the extra cascades across accounts over time.
export type TimelineEntry = {
  id: string;
  name: string;
  clearMonth: number; // month the balance hits zero (0 = not within horizon)
  extraStartMonth: number; // first month it receives any extra (0 = never)
};

export type Simulation = {
  months: number;
  totalInterest: number;
  series: { month: number; balance: number }[];
  allocations: Allocation[]; // first active month, in priority order
  timeline: TimelineEntry[]; // payoff order with extra-start / clear months
  neverPaysOff: boolean;
};

/**
 * Strategy simulation with debt rollover ("waterfall").
 *
 * Each month every account accrues interest and pays its minimum. The extra
 * monthly cash — PLUS the minimums freed by already-paid-off accounts and any
 * over-shoot of a minimum past a tiny balance — forms a pool that cascades down
 * the strategy priority order: it fills the top-priority account first, and the
 * remainder overflows to the next. This is the actual avalanche/snowball
 * behaviour, so paying off the top loan accelerates every loan below it.
 */
export function simulateStrategy(
  loans: LoanLike[],
  extraMonthly: number,
  method: PayoffMethod,
): Simulation {
  type S = {
    id: string;
    name: string;
    bal: number;
    rate: number;
    promoRate: number | null;
    promoUntil: number;
    min: number;
    spend: number;
    revolving: boolean;
  };
  const today = new Date();
  const state: S[] = loans.map((l) => ({
    id: l.id,
    name: l.name,
    bal: outstandingOf(l),
    rate: num(l.interest_rate) / 100 / 12,
    promoRate: promoMonthlyRate(l),
    promoUntil: promoUntilMonth(l, today),
    min: paymentOf(l),
    spend: projectedSpend(l),
    revolving: isRevolving(l),
  }));
  const byId = new Map(state.map((s) => [s.id, s] as const));
  // "even" has no priority order; display biggest-balance first.
  const basePriority =
    method === "even"
      ? [...state].sort((a, b) => b.bal - a.bal)
      : orderLoans(loans, method)
          .map((l) => byId.get(l.id))
          .filter((s): s is S => Boolean(s));
  // Avalanche ranks by rate; a promo makes a card's effective rate change over time,
  // so with any promo present we re-rank each month by the rate in force. Without a
  // promo the effective rate is constant, so this reproduces the fixed order exactly.
  const reranks = method === "avalanche" && state.some((s) => s.promoRate !== null);
  const effRate = (s: S, m: number): number =>
    s.promoRate !== null && m <= s.promoUntil ? s.promoRate : s.rate;

  const extra = Math.max(0, extraMonthly);
  const startBalance = state.reduce((a, s) => a + s.bal, 0);
  const series: { month: number; balance: number }[] = [{ month: 0, balance: round2(startBalance) }];
  const clearMonth = new Map<string, number>();
  const extraStart = new Map<string, number>();
  const cleared = new Set<string>();
  let totalInterest = 0;
  let allocations: Allocation[] = [];
  let month = 0;

  while (month < MONTH_CAP && state.some((s) => s.bal > 0)) {
    month += 1;
    const paid = new Map<string, { minimum: number; extra: number }>(
      state.map((s) => [s.id, { minimum: 0, extra: 0 }]),
    );

    // 1. New charges on still-open revolving cards, then accrue this month's interest
    //    at the rate in force (promo until it expires, then the standard rate).
    for (const s of state) {
      if (s.bal <= 0 && cleared.has(s.id)) continue;
      if (s.revolving && !cleared.has(s.id) && s.spend > 0) s.bal += s.spend;
      if (s.bal <= 0) continue;
      const interest = s.bal * effRate(s, month);
      s.bal += interest;
      totalInterest += interest;
    }

    // 2. Pay minimums. Cleared accounts and minimum over-shoot feed the pool. Revolving
    //    cards recompute the minimum as a % of the live balance (floored at min).
    let pool = extra;
    for (const s of state) {
      if (s.bal <= 0) {
        pool += s.min;
        continue;
      }
      const minDue = s.revolving ? Math.max(s.min, s.bal * REVOLVING_MIN_PCT) : s.min;
      const pay = Math.min(s.bal, minDue);
      s.bal -= pay;
      paid.get(s.id)!.minimum = pay;
      pool += minDue - pay;
    }

    // 3. Apply the pool, re-ranking the avalanche order by the rate in force this month.
    const priority = reranks
      ? [...state].sort((a, b) => effRate(b, month) - effRate(a, month) || a.bal - b.bal)
      : basePriority;
    if (method === "even") {
      // Spread proportionally by balance; redistribute any overflow from
      // accounts that fill up so the whole pool is always used.
      let remaining = pool;
      let active = state.filter((s) => s.bal > 0);
      let guard = 0;
      while (remaining > 0.005 && active.length > 0 && guard++ < 50) {
        const totalBal = active.reduce((a, s) => a + s.bal, 0);
        if (totalBal <= 0) break;
        let distributed = 0;
        for (const s of active) {
          const pay = Math.min(s.bal, remaining * (s.bal / totalBal));
          s.bal -= pay;
          paid.get(s.id)!.extra += pay;
          distributed += pay;
        }
        remaining -= distributed;
        active = active.filter((s) => s.bal > 0);
        if (distributed <= 0.005) break;
      }
    } else {
      // Cascade down the priority order, overflowing as accounts clear.
      for (const s of priority) {
        if (pool <= 0) break;
        if (s.bal <= 0) continue;
        const pay = Math.min(s.bal, pool);
        s.bal -= pay;
        pool -= pay;
        paid.get(s.id)!.extra += pay;
      }
    }

    for (const s of state) s.bal = s.bal > 0 ? round2(s.bal) : 0;

    for (const s of state) {
      if (paid.get(s.id)!.extra > 0 && !extraStart.has(s.id)) extraStart.set(s.id, month);
      if (s.bal <= 0 && !clearMonth.has(s.id)) {
        clearMonth.set(s.id, month);
        cleared.add(s.id);
      }
    }

    if (month === 1) {
      allocations = priority.map((s) => {
        const p = paid.get(s.id)!;
        return {
          id: s.id,
          name: s.name,
          minimum: round2(p.minimum),
          extra: round2(p.extra),
          total: round2(p.minimum + p.extra),
          isTarget: p.extra > 0,
          clears: s.bal <= 0 && p.minimum + p.extra > 0,
        };
      });
    }

    series.push({ month, balance: round2(state.reduce((a, s) => a + Math.max(0, s.bal), 0)) });
  }

  const timeline: TimelineEntry[] = basePriority
    .map((s) => ({
      id: s.id,
      name: s.name,
      clearMonth: clearMonth.get(s.id) ?? 0,
      extraStartMonth: extraStart.get(s.id) ?? 0,
    }))
    .sort(
      (a, b) =>
        (a.extraStartMonth || Number.POSITIVE_INFINITY) - (b.extraStartMonth || Number.POSITIVE_INFINITY) ||
        a.clearMonth - b.clearMonth,
    );

  return {
    months: month,
    totalInterest: round2(totalInterest),
    series,
    allocations,
    timeline,
    neverPaysOff: state.some((s) => s.bal > 0),
  };
}

// Per-month summed balances, using the rollover waterfall.
export function aggregateProjection(
  loans: LoanLike[],
  extraMonthly: number,
  method: PayoffMethod,
): { month: number; balance: number }[] {
  return simulateStrategy(loans, extraMonthly, method).series;
}

// First-month recommended split of the extra across accounts, in priority order.
export function allocationBreakdown(
  loans: LoanLike[],
  extraMonthly: number,
  method: PayoffMethod,
): Allocation[] {
  return simulateStrategy(loans, extraMonthly, method).allocations;
}

// Payoff order: when each account starts getting the extra and when it clears.
export function payoffTimeline(
  loans: LoanLike[],
  extraMonthly: number,
  method: PayoffMethod,
): TimelineEntry[] {
  return simulateStrategy(loans, extraMonthly, method).timeline;
}

export function savingsVsBaseline(
  loans: LoanLike[],
  extraMonthly: number,
  method: PayoffMethod,
): { interestSaved: number; monthsSooner: number; baselinePayoffMonths: number; optimizedPayoffMonths: number } {
  const base = simulateStrategy(loans, 0, method);
  const opt = simulateStrategy(loans, extraMonthly, method);
  return {
    interestSaved: Math.max(0, round2(base.totalInterest - opt.totalInterest)),
    monthsSooner: Math.max(0, base.months - opt.months),
    baselinePayoffMonths: base.months,
    optimizedPayoffMonths: opt.months,
  };
}

// A sensible upper bound for the "extra payment" slider, scaled to the actual
// debt rather than a flat amount: enough to model an aggressive payoff (≈3× the
// minimums, or clearing the balance in ~a year). No flat ceiling — it tracks the
// debt — but never exceeds the total outstanding, since paying more than you owe
// in a month is meaningless.
export function suggestedExtraMax(loans: LoanLike[]): number {
  const totalMin = loans.reduce((a, l) => a + Math.max(0, num(l.min_or_emi_amount)), 0);
  const totalBal = loans.reduce((a, l) => a + outstandingOf(l), 0);
  const candidate = Math.max(totalMin * 3, totalBal / 12);
  const rounded = Math.ceil(candidate / 250) * 250;
  const ceiling = Math.max(1000, Math.ceil(totalBal / 250) * 250);
  return Math.min(ceiling, Math.max(1000, rounded));
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Friendly calendar label for "N months from now", e.g. 14 -> "Aug '27".
// Used for the projection axis and the payoff timeline so users see dates,
// not raw month indices like "M136".
export function monthsToLabel(monthsFromNow: number, base: Date = new Date()): string {
  const idx = base.getMonth() + Math.max(0, Math.round(monthsFromNow));
  const year = base.getFullYear() + Math.floor(idx / 12);
  return `${MONTH_NAMES[((idx % 12) + 12) % 12]} '${String(year).slice(-2)}`;
}

// Human duration for a month count, e.g. 14 -> "1 yr 2 mo".
export function monthsToDuration(months: number): string {
  if (months <= 0) return "—";
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} mo`;
  if (m === 0) return `${y} yr`;
  return `${y} yr ${m} mo`;
}

export function weightedAvgRate(loans: LoanLike[]): number {
  const totalBal = loans.reduce((a, l) => a + outstandingOf(l), 0);
  if (totalBal <= 0) return 0;
  const weighted = loans.reduce((a, l) => a + outstandingOf(l) * num(l.interest_rate), 0);
  return weighted / totalBal;
}

export function totalsSummary(loans: LoanLike[]): {
  totalOutstanding: number;
  totalPrincipal: number;
  totalMonthly: number;
  pctPaid: number;
} {
  const totalOutstanding = loans.reduce((a, l) => a + outstandingOf(l), 0);
  const totalPrincipal = loans.reduce((a, l) => a + num(l.principal), 0);
  const totalMonthly = loans.reduce((a, l) => a + num(l.min_or_emi_amount), 0);
  const pctPaid = totalPrincipal > 0 ? ((totalPrincipal - totalOutstanding) / totalPrincipal) * 100 : 0;
  return { totalOutstanding, totalPrincipal, totalMonthly, pctPaid };
}
