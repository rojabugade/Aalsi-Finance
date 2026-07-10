"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCategories, useTransactions, type Transaction } from "@/lib/api/transactions";
import { useRecurringSeries } from "@/lib/api/widget-data";
import { monthlyFromCadence } from "@/components/dashboard/widgets/recurring-widget";
import { formatCurrency } from "@/lib/format";
import { rangeIncome, rangeSpend, spendAmount } from "@/lib/spend/derive";
import { ymd } from "@/lib/spend/period";
import styles from "@/components/new-dashboard/new-dashboard.module.css";

type HomeTab = "overview" | "goals" | "recommendations";

function daysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return ymd(d);
}

function pct(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function NewDashboard() {
  const searchParams = useSearchParams();
  const txns = useTransactions();
  const cats = useCategories();
  const recurring = useRecurringSeries("active");

  const tabParam = searchParams.get("tab");
  const activeTab: HomeTab = tabParam === "goals" || tabParam === "recommendations" ? tabParam : "overview";
  const allTxns = txns.data ?? [];
  const allCats = cats.data ?? [];
  const byId = useMemo(() => new Map(allCats.map((c) => [c.id, c])), [allCats]);
  const currency = allTxns[0]?.currency ?? "USD";
  const from = daysAgo(30);
  const to = ymd(new Date());
  const spent = rangeSpend(allTxns, allCats, from, to);
  const income = rangeIncome(allTxns, allCats, from, to);
  const recurringMonthly = (recurring.data ?? []).reduce(
    (sum, r) => sum + monthlyFromCadence(Number(r.amount ?? 0), r.cadence),
    0,
  );
  const safeToSpend = income - spent - recurringMonthly;
  const health = pct(income > 0 ? 100 - (spent / income) * 70 - (recurringMonthly / income) * 20 : allTxns.length ? 45 : 72);
  const latest = [...allTxns].sort((a, b) => b.txn_date.localeCompare(a.txn_date)).slice(0, 1);
  const topTransaction = latest[0] ?? null;
  const nextRecurring = [...(recurring.data ?? [])]
    .filter((r) => r.next_due_date)
    .sort((a, b) => String(a.next_due_date).localeCompare(String(b.next_due_date)))[0];
  const debtTotal = allTxns.reduce((sum, t) => {
    const cat = t.category_id ? byId.get(t.category_id) : null;
    return cat?.name.toLowerCase().includes("debt") ? sum + spendAmount(t, byId) : sum;
  }, 0);
  const savingsRate = income > 0 ? Math.round(((income - spent) / income) * 100) : 0;
  const nextAction = safeToSpend < 0
    ? "Review the last few expenses before adding more discretionary spend."
    : topTransaction
      ? "Open Spend and inspect the latest merchant pattern before the next purchase."
      : "Upload a receipt or statement to get personalized recommendations.";
  const asOfLabel = `As of ${to} · last 30 days`;

  return (
    <div className={styles.newDashboard} data-testid="new-dashboard">
      <div className={styles.topLine}>
        <div className={styles.tabs} role="tablist" aria-label="Dashboard sections">
          <DashboardTab active={activeTab === "overview"} href="/dashboard" label="Overview" />
          <DashboardTab active={activeTab === "goals"} href="/dashboard?tab=goals" label="Goals" />
          <DashboardTab active={activeTab === "recommendations"} href="/dashboard?tab=recommendations" label="Recommendations" />
        </div>
        <span className={styles.freshness}>{asOfLabel}</span>
      </div>

      {activeTab === "overview" ? (
      <section className={styles.homeMinimal} aria-label="Dashboard overview">
        <article className={styles.homeHero}>
          <div>
            <span className={styles.pill}>Today</span>
            <h2>ALSI</h2>
            <h3>For people who are lazy about managing money—we&apos;ll do it for you.</h3>
          </div>
          <div className={styles.healthDial} style={{ background: `conic-gradient(#0b9d75 ${health}%, #dbe7e3 0)` }}>
            <strong>{health}</strong>
            <span>/100</span>
          </div>
        </article>

        <ReminderCarousel
          safeToSpend={safeToSpend}
          savingsRate={savingsRate}
          latest={topTransaction}
          nextRecurring={nextRecurring ? {
            name: nextRecurring.name,
            amount: Number(nextRecurring.amount ?? 0),
            currency: nextRecurring.currency,
            due: nextRecurring.next_due_date ?? null,
          } : null}
          currency={currency}
        />

        <section className={styles.homeStats}>
          <MiniStat label="Safe to spend" value={formatCurrency(safeToSpend, { currency })} detail="Income minus spend and recurring obligations" tone="mint" />
          <MiniStat label="Income" value={formatCurrency(income, { currency })} detail="Tracked deposits in the last 30 days" />
          <MiniStat label="Debt spend" value={formatCurrency(debtTotal, { currency })} detail="Debt-category outflow in this period" />
        </section>

        <section className={styles.homeFocusGrid}>
          <article className={`${styles.card} ${styles.focusCard}`}>
            <CardHeader label="Latest activity" />
            {topTransaction ? <ActivityList transactions={[topTransaction]} /> : <p className={styles.empty}>No transactions yet.</p>}
          </article>
          <article className={`${styles.card} ${styles.focusCard}`}>
            <CardHeader label="Next best action" />
            <p>{nextAction}</p>
          </article>
        </section>
      </section>
      ) : activeTab === "goals" ? (
        <GoalsPanel
          currency={currency}
          debtTotal={debtTotal}
          income={income}
          safeToSpend={safeToSpend}
          savingsRate={savingsRate}
        />
      ) : (
        <RecommendationsPanel
          latest={topTransaction}
          nextAction={nextAction}
          nextRecurring={nextRecurring ? {
            name: nextRecurring.name,
            amount: Number(nextRecurring.amount ?? 0),
            currency: nextRecurring.currency,
            due: nextRecurring.next_due_date ?? null,
          } : null}
          safeToSpend={safeToSpend}
        />
      )}
    </div>
  );
}

function DashboardTab({ active, href, label }: { active: boolean; href: string; label: string }) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`${styles.tab} ${active ? styles.tabActive : ""}`}
      href={href}
      role="tab"
    >
      {label}
    </Link>
  );
}

function ReminderCarousel({
  safeToSpend,
  savingsRate,
  latest,
  nextRecurring,
  currency,
}: {
  safeToSpend: number;
  savingsRate: number;
  latest: Transaction | null;
  nextRecurring: { name: string; amount: number; currency: string; due: string | null } | null;
  currency: string;
}) {
  const carouselRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const wheelVelocityRef = useRef(0);
  const loopWidthRef = useRef(0);
  const reminders = [
    nextRecurring
      ? { label: "Payment due", title: nextRecurring.name, detail: `${formatCurrency(nextRecurring.amount, { currency: nextRecurring.currency })}${nextRecurring.due ? ` due ${nextRecurring.due}` : ""}` }
      : { label: "Debt", title: "No debt reminder", detail: "Add a loan to track due dates." },
    { label: "Safe spend", title: formatCurrency(safeToSpend, { currency }), detail: "Available after tracked spending." },
    latest
      ? { label: "Recent charge", title: latest.merchant ?? "Unknown", detail: `${formatCurrency(Math.abs(Number(latest.amount)), { currency: latest.currency })} tracked activity` }
      : { label: "Activity", title: "No recent charges", detail: "Upload a document to begin." },
    { label: "Savings rate", title: `${savingsRate}%`, detail: "Based on income minus tracked spend." },
  ];

  useEffect(() => {
    const carousel = carouselRef.current;
    const track = trackRef.current;
    if (!carousel || !track) return undefined;

    const autoplayPxPerSecond = 22;
    const maxWheelVelocity = 1200;
    const wheelFriction = 0.9;
    let frame = 0;
    let lastTime = performance.now();

    const measureLoop = () => {
      loopWidthRef.current = track.scrollWidth / 2;
      offsetRef.current = wrap(offsetRef.current);
      render();
    };

    const wrap = (value: number) => {
      const loopWidth = loopWidthRef.current;
      if (!loopWidth) return 0;
      return ((value % loopWidth) + loopWidth) % loopWidth;
    };

    const render = () => {
      track.style.transform = `translate3d(${-offsetRef.current}px, 0, 0)`;
    };

    const tick = (time: number) => {
      const deltaSeconds = Math.min((time - lastTime) / 1000, 0.08);
      lastTime = time;
      offsetRef.current = wrap(
        offsetRef.current + autoplayPxPerSecond * deltaSeconds + wheelVelocityRef.current * deltaSeconds,
      );
      wheelVelocityRef.current *= Math.pow(wheelFriction, deltaSeconds * 60);
      if (Math.abs(wheelVelocityRef.current) < 1) wheelVelocityRef.current = 0;
      render();
      frame = requestAnimationFrame(tick);
    };

    const onWheel = (event: WheelEvent) => {
      if (event.cancelable) event.preventDefault();
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const normalizedDelta = event.deltaMode === 1 ? delta * 16 : delta;
      wheelVelocityRef.current = Math.max(
        -maxWheelVelocity,
        Math.min(maxWheelVelocity, wheelVelocityRef.current + normalizedDelta * 8),
      );
    };

    const resizeObserver = new ResizeObserver(measureLoop);
    resizeObserver.observe(track);
    measureLoop();
    carousel.addEventListener("wheel", onWheel, { passive: false });
    frame = requestAnimationFrame(tick);

    return () => {
      resizeObserver.disconnect();
      carousel.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(frame);
      track.style.transform = "";
      wheelVelocityRef.current = 0;
    };
  }, []);

  return (
    <section className={styles.reminderShell} aria-label="Priority reminders">
      <div ref={carouselRef} className={styles.reminderCarousel} aria-label="Priority reminders carousel">
        <div ref={trackRef} className={styles.reminderTrack}>
          <div className={styles.reminderGroup}>
            {reminders.map((reminder) => (
              <article className={styles.reminderAd} key={reminder.label}>
                <span>{reminder.label}</span>
                <strong>{reminder.title}</strong>
                <small>{reminder.detail}</small>
              </article>
            ))}
          </div>
          <div aria-hidden="true" className={styles.reminderGroup}>
            {reminders.map((reminder) => (
              <article className={styles.reminderAd} key={`${reminder.label}-duplicate`}>
                <span>{reminder.label}</span>
                <strong>{reminder.title}</strong>
                <small>{reminder.detail}</small>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function MiniStat({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "mint" }) {
  return (
    <article className={`${styles.miniStat} ${tone === "mint" ? styles.mint : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function CardHeader({ label }: { label: string }) {
  return (
    <div className={styles.cardHeader}>
      <span>{label}</span>
      <button type="button" aria-label={`${label} options`}>...</button>
    </div>
  );
}

function ActivityList({ transactions }: { transactions: Transaction[] }) {
  return (
    <div className={styles.activityList}>
      {transactions.map((transaction) => (
        <div className={styles.activityRow} key={transaction.id}>
          <span className={styles.initial}>{(transaction.merchant ?? "U").slice(0, 1)}</span>
          <span>
            <b>{transaction.merchant ?? "Unknown"}</b>
            <small>{transaction.txn_date} · {transaction.status}</small>
          </span>
          <strong>{formatCurrency(Math.abs(Number(transaction.amount)), { currency: transaction.currency })}</strong>
        </div>
      ))}
    </div>
  );
}

function GoalsPanel({
  currency,
  debtTotal,
  income,
  safeToSpend,
  savingsRate,
}: {
  currency: string;
  debtTotal: number;
  income: number;
  safeToSpend: number;
  savingsRate: number;
}) {
  const monthlyBufferTarget = Math.max(500, income * 0.2);
  const bufferProgress = income > 0 ? Math.round((Math.max(safeToSpend, 0) / monthlyBufferTarget) * 100) : 0;

  return (
    <section className={styles.panelGrid} aria-label="Goals">
      <article className={`${styles.card} ${styles.priorityCard}`}>
        <CardHeader label="Primary goal" />
        <h2>Build a monthly buffer</h2>
        <p>Keep discretionary spend below the safe-to-spend line until the buffer reaches {formatCurrency(monthlyBufferTarget, { currency })}.</p>
        <div className={styles.progressTrack} aria-label={`${bufferProgress}% of monthly buffer target`}>
          <span style={{ width: `${pct(bufferProgress)}%` }} />
        </div>
      </article>
      <MiniStat label="Buffer progress" value={`${pct(bufferProgress)}%`} detail="Safe-to-spend against this month's buffer target" tone="mint" />
      <MiniStat label="Savings rate" value={`${savingsRate}%`} detail="Income left after tracked spend" />
      <MiniStat label="Debt pressure" value={formatCurrency(debtTotal, { currency })} detail="Debt-category outflow this period" />
    </section>
  );
}

function RecommendationsPanel({
  latest,
  nextAction,
  nextRecurring,
  safeToSpend,
}: {
  latest: Transaction | null;
  nextAction: string;
  nextRecurring: { name: string; amount: number; currency: string; due: string | null } | null;
  safeToSpend: number;
}) {
  const recommendations = [
    {
      label: safeToSpend < 0 ? "Spend guardrail" : "Next action",
      title: safeToSpend < 0 ? "Pause optional purchases" : "Review merchant pattern",
      detail: nextAction,
    },
    nextRecurring
      ? {
          label: "Upcoming obligation",
          title: nextRecurring.name,
          detail: `${formatCurrency(nextRecurring.amount, { currency: nextRecurring.currency })}${nextRecurring.due ? ` due ${nextRecurring.due}` : ""}`,
        }
      : {
          label: "Recurring setup",
          title: "Add recurring bills",
          detail: "Recurring detection improves the safe-to-spend estimate.",
        },
    latest
      ? {
          label: "Latest activity",
          title: latest.merchant ?? "Unknown merchant",
          detail: `${formatCurrency(Math.abs(Number(latest.amount)), { currency: latest.currency })} on ${latest.txn_date}`,
        }
      : {
          label: "Data setup",
          title: "Import activity",
          detail: "Upload a statement or receipt so recommendations can use real transactions.",
        },
  ];

  return (
    <section className={styles.panelGrid} aria-label="Recommendations">
      {recommendations.map((item, index) => (
        <article className={`${styles.card} ${index === 0 ? styles.priorityCard : ""}`} key={item.label}>
          <CardHeader label={item.label} />
          <h2>{item.title}</h2>
          <p>{item.detail}</p>
        </article>
      ))}
    </section>
  );
}
