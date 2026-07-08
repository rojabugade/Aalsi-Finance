"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  useCreateIncomeSource,
  useIncomeSources,
  useTakeHome,
  type IncomeSource,
} from "@/lib/api/income";
import { EquitySection } from "@/components/income/equity-section";
import { CashflowHero } from "@/components/income/cashflow-hero";
import { RecurringManager } from "@/components/income/recurring-manager";
import { AssetsSection } from "@/components/income/assets-section";
import { SectionIntro } from "@/components/insights/section-intro";
import { KeyValues } from "@/components/guidance/citations";
import { formatCurrency } from "@/lib/format";
import { Wallet } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { RowList, StatRow } from "@/components/ui/row-list";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function IncomePage() {
  const sources = useIncomeSources();
  const [takeHomeId, setTakeHomeId] = useState<string | null>(null);
  const takeHome = useTakeHome(takeHomeId);

  return (
    <div className="space-y-8">
      <SectionIntro title="Money" blurb="What comes in, what's committed, and what's left." />

      <CashflowHero />

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Earnings</h3>
          <NewSourceDialog />
        </div>

        {sources.isError ? (
          <div className="rounded-card-sm border border-border bg-card p-6 text-sm text-destructive shadow-card">
            Couldn&apos;t load income sources.
          </div>
        ) : sources.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-36" />
            ))}
          </div>
        ) : (sources.data ?? []).length === 0 ? (
          <div className="rounded-card-sm border border-border bg-card py-16 text-center text-sm text-muted shadow-card">
            No income sources yet. Add one to estimate take-home pay.
          </div>
        ) : (
          <RowList>
            {(sources.data ?? []).map((s) => (
              <StatRow
                key={s.id}
                icon={Wallet}
                tint="accent"
                label={s.employer ?? "Income source"}
                sub={`${s.frequency}${s.country ? ` · ${s.country}` : ""}`}
                value={s.gross != null ? formatCurrency(s.gross, { currency: s.currency }) : ""}
                onClick={() => setTakeHomeId(s.id)}
              />
            ))}
          </RowList>
        )}
      </section>

      <EquitySection sources={sources.data ?? []} />

      <RecurringManager />

      <AssetsSection />

      <ResponsiveSheet
        open={Boolean(takeHomeId)}
        onOpenChange={(v) => !v && setTakeHomeId(null)}
        title="Take-home estimate"
      >
          {takeHome.isLoading ? (
            <Skeleton className="h-40" />
          ) : takeHome.isError ? (
            <p className="text-sm text-destructive">Couldn&apos;t estimate take-home.</p>
          ) : takeHome.data ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted">Gross / period</p>
                  <p data-numeric className="mt-1 font-semibold">
                    {formatCurrency(takeHome.data.gross_period, {
                      currency: takeHome.data.currency,
                    })}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted">Gross / year</p>
                  <p data-numeric className="mt-1 font-semibold">
                    {formatCurrency(takeHome.data.gross_annual, {
                      currency: takeHome.data.currency,
                    })}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-semibold">Estimates</p>
                <KeyValues data={takeHome.data.estimates as Record<string, unknown>} />
              </div>
              <p className="text-xs text-muted">{takeHome.data.disclaimer}</p>
            </div>
          ) : null}
      </ResponsiveSheet>
    </div>
  );
}

function NewSourceDialog() {
  const [open, setOpen] = useState(false);
  const create = useCreateIncomeSource();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const str = (k: string) => {
      const v = String(form.get(k) ?? "").trim();
      return v || null;
    };
    try {
      await create.mutateAsync({
        employer: str("employer"),
        country: str("country"),
        currency: String(form.get("currency") ?? "USD"),
        frequency: String(form.get("frequency") ?? "monthly"),
        gross: str("gross"),
        net: str("net"),
      });
      toast.success("Income source added");
      setOpen(false);
    } catch {
      toast.error("Couldn't add income source");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add source</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add income source</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="employer">Employer</Label>
            <Input id="employer" name="employer" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="frequency">Frequency</Label>
              <select id="frequency" name="frequency" className={SELECT_CLASS} defaultValue="monthly">
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="semimonthly">Semimonthly</option>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="country">Country</Label>
              <Input id="country" name="country" maxLength={2} placeholder="US" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="gross">Gross</Label>
              <Input id="gross" name="gross" type="number" min="0" step="0.01" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="net">Net</Label>
              <Input id="net" name="net" type="number" min="0" step="0.01" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" name="currency" defaultValue="USD" maxLength={3} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Add source"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
