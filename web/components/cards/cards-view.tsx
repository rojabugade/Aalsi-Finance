import Link from "next/link";
import type { Loan } from "@/lib/api/loans";
import { formatCurrency } from "@/lib/format";
import { CardTile } from "./card-tile";

const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

export function CardsView({ loans }: { loans: Loan[] }) {
  const cards = loans.filter((l) => l.type === "credit_card");

  if (cards.length === 0) {
    return (
      <div className="rounded-card-sm border border-border bg-card py-16 text-center shadow-card">
        <p className="text-base font-semibold">No credit cards yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
          Link a bank with Plaid to import your cards, balances, and statements.
        </p>
        <Link href="/connections" className="mt-4 inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground">
          Connect a card
        </Link>
      </div>
    );
  }

  const ccy = cards[0].currency ?? "USD";
  const totalBalance = cards.reduce((a, c) => a + n(c.outstanding_balance ?? c.principal), 0);
  const totalLimit = cards.reduce((a, c) => a + n(c.credit_card_detail?.credit_limit), 0);
  const blended = totalLimit > 0 ? Math.round((totalBalance / totalLimit) * 100) : null;

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-3 gap-3 rounded-card-sm border border-border bg-card p-5 shadow-card">
        <Stat label="Total balance">{formatCurrency(totalBalance, { currency: ccy })}</Stat>
        <Stat label="Total limit">{formatCurrency(totalLimit, { currency: ccy })}</Stat>
        <Stat label="Utilization">{blended != null ? `${blended}%` : "—"}</Stat>
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((c) => <CardTile key={c.id} loan={c} />)}
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums">{children}</p>
    </div>
  );
}
