import { describe, expect, it } from "vitest";
import {
  aggregateProjection,
  allocationBreakdown,
  amortize,
  num,
  orderLoans,
  savingsVsBaseline,
  monthsToDuration,
  monthsToLabel,
  payoffTimeline,
  simulateStrategy,
  suggestedExtraMax,
  totalsSummary,
  weightedAvgRate,
  type LoanLike,
} from "./debt-math";

const card: LoanLike = {
  id: "card", name: "Card", outstanding_balance: 10000, principal: 10000,
  interest_rate: 18, min_or_emi_amount: 300, currency: "USD",
};
const auto: LoanLike = {
  id: "auto", name: "Auto", outstanding_balance: 4000, principal: 12000,
  interest_rate: 6, min_or_emi_amount: 250, currency: "USD",
};

describe("num", () => {
  it("coerces strings, null, undefined", () => {
    expect(num("12.5")).toBe(12.5);
    expect(num(null)).toBe(0);
    expect(num(undefined)).toBe(0);
  });
});

describe("amortize", () => {
  it("pays off and accrues interest", () => {
    const r = amortize(10000, 18, 300);
    expect(r.neverPaysOff).toBe(false);
    expect(r.months).toBeGreaterThan(0);
    expect(r.totalInterest).toBeGreaterThan(0);
    expect(r.series[r.series.length - 1]).toBe(0);
  });
  it("flags neverPaysOff when payment <= monthly interest", () => {
    const r = amortize(10000, 18, 150); // monthly interest = 150
    expect(r.neverPaysOff).toBe(true);
  });
  it("a bigger payment costs less interest and finishes sooner", () => {
    const slow = amortize(10000, 18, 300);
    const fast = amortize(10000, 18, 500);
    expect(fast.months).toBeLessThan(slow.months);
    expect(fast.totalInterest).toBeLessThan(slow.totalInterest);
  });
});

describe("orderLoans", () => {
  it("snowball = smallest balance first", () => {
    expect(orderLoans([card, auto], "snowball").map((l) => l.id)).toEqual(["auto", "card"]);
  });
  it("avalanche = highest rate first", () => {
    expect(orderLoans([card, auto], "avalanche").map((l) => l.id)).toEqual(["card", "auto"]);
  });
});

describe("aggregateProjection", () => {
  it("starts at the summed balance and trends to zero", () => {
    const series = aggregateProjection([card, auto], 0, "avalanche");
    expect(series[0].balance).toBeGreaterThan(13000);
    expect(series[series.length - 1].balance).toBe(0);
  });
  it("extra payment shortens the series", () => {
    const base = aggregateProjection([card, auto], 0, "avalanche");
    const boosted = aggregateProjection([card, auto], 300, "avalanche");
    expect(boosted.length).toBeLessThan(base.length);
  });
});

describe("savingsVsBaseline", () => {
  it("extra payment saves interest and months", () => {
    const s = savingsVsBaseline([card, auto], 300, "avalanche");
    expect(s.interestSaved).toBeGreaterThan(0);
    expect(s.monthsSooner).toBeGreaterThan(0);
    expect(s.optimizedPayoffMonths).toBeLessThan(s.baselinePayoffMonths);
  });
});

describe("simulateStrategy (rollover waterfall)", () => {
  // A small high-rate loan + a big low-rate loan. The big one dominates the
  // payoff horizon, so the OLD model (extra on rank-1 only, no rollover) left
  // months-sooner stuck at 0. With rollover the freed minimum cascades.
  const small: LoanLike = {
    id: "small", name: "Card", outstanding_balance: 8000, principal: 8000,
    interest_rate: 14, min_or_emi_amount: 250,
  };
  const big: LoanLike = {
    id: "big", name: "Student", outstanding_balance: 40000, principal: 40000,
    interest_rate: 5, min_or_emi_amount: 450,
  };

  it("rolls freed minimums forward so extra actually shortens total payoff", () => {
    const s = savingsVsBaseline([small, big], 600, "avalanche");
    expect(s.monthsSooner).toBeGreaterThan(0);
    expect(s.interestSaved).toBeGreaterThan(0);
    expect(s.optimizedPayoffMonths).toBeLessThan(s.baselinePayoffMonths);
  });

  it("more extra is never slower and never costs more interest", () => {
    const a = simulateStrategy([small, big], 200, "avalanche");
    const b = simulateStrategy([small, big], 800, "avalanche");
    expect(b.months).toBeLessThanOrEqual(a.months);
    expect(b.totalInterest).toBeLessThanOrEqual(a.totalInterest);
  });
});

describe("allocationBreakdown", () => {
  const small: LoanLike = {
    id: "small", name: "Card", outstanding_balance: 8000, principal: 8000,
    interest_rate: 14, min_or_emi_amount: 250,
  };
  const big: LoanLike = {
    id: "big", name: "Student", outstanding_balance: 40000, principal: 40000,
    interest_rate: 5, min_or_emi_amount: 450,
  };

  it("sends the whole extra to the avalanche target when it can absorb it", () => {
    const rows = allocationBreakdown([small, big], 600, "avalanche");
    const target = rows.find((r) => r.id === "small")!;
    const other = rows.find((r) => r.id === "big")!;
    expect(target.extra).toBeCloseTo(600, 1);
    expect(other.extra).toBe(0);
    // The split sums to the extra, not a blind 50/50.
    expect(rows.reduce((a, r) => a + r.extra, 0)).toBeCloseTo(600, 1);
  });

  it("overflows the remainder to the next account when the target is nearly clear", () => {
    const tiny: LoanLike = {
      id: "tiny", name: "Store card", outstanding_balance: 300, principal: 300,
      interest_rate: 22, min_or_emi_amount: 25,
    };
    const rows = allocationBreakdown([tiny, big], 1000, "avalanche");
    const t = rows.find((r) => r.id === "tiny")!;
    const o = rows.find((r) => r.id === "big")!;
    expect(t.clears).toBe(true);
    expect(t.extra).toBeGreaterThan(0);
    expect(o.extra).toBeGreaterThan(0); // remainder cascaded
    expect(t.extra + o.extra).toBeCloseTo(1000, 1);
  });
});

describe("even split method", () => {
  const a: LoanLike = { id: "a", name: "A", outstanding_balance: 8000, principal: 8000, interest_rate: 14, min_or_emi_amount: 250 };
  const b: LoanLike = { id: "b", name: "B", outstanding_balance: 40000, principal: 40000, interest_rate: 5, min_or_emi_amount: 450 };

  it("spreads the extra across every account instead of concentrating", () => {
    const rows = allocationBreakdown([a, b], 600, "even");
    expect(rows.every((r) => r.extra > 0)).toBe(true);
    expect(rows.reduce((s, r) => s + r.extra, 0)).toBeCloseTo(600, 1);
  });

  it("costs more (or equal) interest than avalanche — that's the trade-off", () => {
    const even = simulateStrategy([a, b], 600, "even");
    const avalanche = simulateStrategy([a, b], 600, "avalanche");
    expect(even.totalInterest).toBeGreaterThanOrEqual(avalanche.totalInterest - 0.01);
  });
});

describe("payoffTimeline", () => {
  const a: LoanLike = { id: "a", name: "A", outstanding_balance: 8000, principal: 8000, interest_rate: 14, min_or_emi_amount: 250 };
  const b: LoanLike = { id: "b", name: "B", outstanding_balance: 40000, principal: 40000, interest_rate: 5, min_or_emi_amount: 450 };

  it("orders accounts by when the extra reaches them and records clear months", () => {
    const tl = payoffTimeline([a, b], 600, "avalanche");
    expect(tl.map((t) => t.id)).toEqual(["a", "b"]); // high-APR funded first
    expect(tl[0].extraStartMonth).toBe(1);
    expect(tl[0].clearMonth).toBeGreaterThan(0);
    expect(tl[0].clearMonth).toBeLessThan(tl[1].clearMonth); // a clears before b
    expect(tl[1].extraStartMonth).toBeGreaterThan(tl[0].clearMonth - 1); // b funded after a clears
  });
});

describe("month labels", () => {
  it("formats a month offset as a friendly calendar label", () => {
    const base = new Date(2026, 0, 1); // Jan 2026
    expect(monthsToLabel(0, base)).toBe("Jan '26");
    expect(monthsToLabel(14, base)).toBe("Mar '27");
  });
  it("formats a month count as a human duration", () => {
    expect(monthsToDuration(0)).toBe("—");
    expect(monthsToDuration(5)).toBe("5 mo");
    expect(monthsToDuration(12)).toBe("1 yr");
    expect(monthsToDuration(14)).toBe("1 yr 2 mo");
  });
});

describe("suggestedExtraMax", () => {
  it("scales with the debt with no flat cap (floor $1k, ceiling = outstanding)", () => {
    const tiny = suggestedExtraMax([
      { id: "x", name: "x", outstanding_balance: 500, principal: 500, interest_rate: 10, min_or_emi_amount: 25 },
    ]);
    expect(tiny).toBe(1000); // floor

    // 200000/12 = 16666.67 -> rounded up to a 250 step; well past the old $10k cap.
    const big = suggestedExtraMax([
      { id: "y", name: "y", outstanding_balance: 200000, principal: 200000, interest_rate: 7, min_or_emi_amount: 1800 },
    ]);
    expect(big).toBe(16750);
    expect(big % 250).toBe(0);
  });
});

describe("debt sim upgrades (parity with backend debt_plan.py)", () => {
  it("revolving cards pay off under a dynamic min where a flat min never would", () => {
    // 10k @ 12% => $100/mo interest. A flat $100 min only covers interest; a
    // revolving card lifts the min to 2% of the balance ($200 early) so it clears.
    const flat = simulateStrategy(
      [{ id: "a", name: "A", outstanding_balance: 10000, principal: 10000, interest_rate: 12, min_or_emi_amount: 100, schedule_kind: "amortizing" }],
      0,
      "avalanche",
    );
    const revolving = simulateStrategy(
      [{ id: "a", name: "A", outstanding_balance: 10000, principal: 10000, interest_rate: 12, min_or_emi_amount: 100, schedule_kind: "revolving" }],
      0,
      "avalanche",
    );
    expect(flat.neverPaysOff).toBe(true);
    expect(revolving.neverPaysOff).toBe(false);
    expect(revolving.months).toBeGreaterThan(0);
  });

  it("promo APR re-ranks the avalanche target while the intro rate is active", () => {
    const far = new Date();
    far.setFullYear(far.getFullYear() + 5);
    const iso = far.toISOString().slice(0, 10);
    const a: LoanLike = { id: "a", name: "A", outstanding_balance: 5000, principal: 5000, interest_rate: 30, min_or_emi_amount: 100, schedule_kind: "revolving", promo_rate: 0, promo_expiry_date: iso };
    const b: LoanLike = { id: "b", name: "B", outstanding_balance: 5000, principal: 5000, interest_rate: 20, min_or_emi_amount: 100, schedule_kind: "revolving" };

    const withPromo = payoffTimeline([a, b], 400, "avalanche");
    const bEntry = withPromo.find((t) => t.id === "b")!;
    const aEntry = withPromo.find((t) => t.id === "a")!;
    expect(bEntry.extraStartMonth).toBe(1); // B (20%, no promo) funded first
    expect(aEntry.extraStartMonth === 0 || aEntry.extraStartMonth > bEntry.extraStartMonth).toBe(true);

    // Drop the promo and the 30% card is funded first — proves the flip.
    const noPromo = payoffTimeline([{ ...a, promo_rate: null, promo_expiry_date: null }, b], 400, "avalanche");
    expect(noPromo.find((t) => t.id === "a")!.extraStartMonth).toBe(1);
  });

  it("projected monthly spend lengthens payoff for a revolving card", () => {
    const base = simulateStrategy(
      [{ id: "a", name: "A", outstanding_balance: 5000, principal: 5000, interest_rate: 12, min_or_emi_amount: 300, schedule_kind: "revolving" }],
      100,
      "avalanche",
    );
    const withSpend = simulateStrategy(
      [{ id: "a", name: "A", outstanding_balance: 5000, principal: 5000, interest_rate: 12, min_or_emi_amount: 300, schedule_kind: "revolving", projected_monthly_spend: 150 }],
      100,
      "avalanche",
    );
    expect(withSpend.months).toBeGreaterThan(base.months);
  });
});

describe("weightedAvgRate / totalsSummary", () => {
  it("weights APR by outstanding balance", () => {
    // (10000*18 + 4000*6) / 14000 = 14.57...
    expect(weightedAvgRate([card, auto])).toBeCloseTo(14.571, 2);
  });
  it("summarizes totals and percent paid", () => {
    const t = totalsSummary([card, auto]);
    expect(t.totalOutstanding).toBe(14000);
    expect(t.totalPrincipal).toBe(22000);
    expect(t.totalMonthly).toBe(550);
    expect(t.pctPaid).toBeCloseTo(36.36, 1); // (22000-14000)/22000
  });
});
