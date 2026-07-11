"use client";

import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useCreatePlanItem,
  usePlanItems,
  useWizard,
  type GuidanceChecklistItem,
  type GuidancePlanItemCreate,
  type WizardOut,
} from "@/lib/api/guidance";

const ACCOUNT_TYPES = ["Brokerage", "Retirement", "Bank account", "Real estate"];

function normalize(title: string) {
  return title.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function domainLabel(domain: GuidanceChecklistItem["domain"]) {
  return domain === "cross_border" ? "Cross-border" : domain === "investment" ? "Investment" : "General";
}

function checklistPayload(item: GuidanceChecklistItem): GuidancePlanItemCreate {
  const sourceRefs = item.source_url
    ? [{
        title: item.title,
        source_url: item.source_url,
        source_type: item.source_type,
        effective_date: item.effective_date,
      }]
    : [];

  return {
    title: item.title,
    rationale: item.why_it_may_apply,
    domain: item.domain,
    source_refs: sourceRefs as unknown as GuidancePlanItemCreate["source_refs"],
  };
}

export function PlanBuilder() {
  const id = useId();
  const wizard = useWizard();
  const create = useCreatePlanItem();
  const plan = usePlanItems("open");
  const [result, setResult] = useState<WizardOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [savingTitles, setSavingTitles] = useState<Set<string>>(() => new Set());

  const existingItems = useMemo(
    () => new Set((plan.data ?? []).filter((item) => item.status === "open").map((item) => `${item.domain}:${normalize(item.title)}`)),
    [plan.data],
  );
  const savedItems = useMemo(() => new Set([...existingItems, ...savingTitles]), [existingItems, savingTitles]);
  const checklist = result?.checklist ?? [];
  const remaining = checklist.filter((item) => !savedItems.has(`${item.domain}:${normalize(item.title)}`));

  async function build(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const countries = String(form.get("countries") ?? "")
      .split(",")
      .map((country) => country.trim())
      .filter(Boolean);
    const amount = String(form.get("annual_transfer_amount") ?? "").trim();
    const accountTypes = ACCOUNT_TYPES.filter((type) => form.getAll("account_types").includes(type));

    try {
      const next = await wizard.mutateAsync({
        crossBorder: false,
        body: {
          countries,
          residency: String(form.get("residency") ?? "").trim() || null,
          annual_transfer_amount: amount || null,
          transfer_currency: String(form.get("transfer_currency") ?? "USD").trim().toUpperCase() || null,
          account_types: accountTypes,
          create_reminders: false,
        },
      });
      setResult(next);
      setSavingTitles(new Set());
    } catch {
      setError("Couldn't build your checklist. Your answers are still here; please try again.");
    }
  }

  async function addOne(item: GuidanceChecklistItem) {
    const key = `${item.domain}:${normalize(item.title)}`;
    if (savedItems.has(key)) return;
    try {
      await create.mutateAsync(checklistPayload(item));
      setSavingTitles((current) => new Set(current).add(key));
      toast.success("Added to My Plan");
    } catch {
      toast.error("Couldn't add this item to My Plan");
    }
  }

  async function addAll() {
    setConfirmingAll(false);
    let added = 0;
    const alreadySaved = checklist.length - remaining.length;
    try {
      for (const item of remaining) {
        await create.mutateAsync(checklistPayload(item));
        added += 1;
        setSavingTitles((current) => new Set(current).add(`${item.domain}:${normalize(item.title)}`));
      }
      toast.success(`Added ${added} ${added === 1 ? "item" : "items"}. ${alreadySaved} already saved.`);
    } catch {
      toast.error("Couldn't add every checklist item. Please try the remaining items again.");
    }
  }

  return (
    <section className="space-y-4 rounded-card-sm border border-border bg-card p-4 shadow-card" aria-labelledby={`${id}-title`}>
      <div>
        <h2 id={`${id}-title`} className="text-base font-bold tracking-tight">Build your guidance plan</h2>
        <p className="mt-1 text-sm text-muted">Answer a few questions to make a sourced checklist you can keep.</p>
      </div>

      <form onSubmit={build} className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={`${id}-countries`}>Countries</Label>
          <Input id={`${id}-countries`} name="countries" defaultValue="US, IN" placeholder="US, IN" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-residency`}>Residency</Label>
          <Input id={`${id}-residency`} name="residency" placeholder="Where you are tax resident" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-annual-transfers`}>Expected annual transfers</Label>
          <Input id={`${id}-annual-transfers`} name="annual_transfer_amount" type="number" min="0" step="0.01" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-currency`}>Transfer currency</Label>
          <Input id={`${id}-currency`} name="transfer_currency" defaultValue="USD" maxLength={3} />
        </div>
        <fieldset className="space-y-1 sm:col-span-2">
          <legend className="text-sm font-medium">Account types</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {ACCOUNT_TYPES.map((type) => (
              <Label key={type} className="flex items-center gap-2 font-normal">
                <input type="checkbox" name="account_types" value={type} />
                {type}
              </Label>
            ))}
          </div>
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={wizard.isPending}>
            {wizard.isPending ? "Building checklist…" : "Build checklist"}
          </Button>
        </div>
      </form>

      {result && (
        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Your suggested checklist</h3>
              <p className="text-sm text-muted">Review each item before saving it to My Plan.</p>
            </div>
            <Button type="button" variant="secondary" onClick={() => setConfirmingAll(true)} disabled={remaining.length === 0 || create.isPending}>
              Add all to My Plan
            </Button>
          </div>
          {result.disclaimer && <p className="text-xs text-muted">{result.disclaimer}</p>}
          <div className="space-y-3">
            {checklist.map((item) => {
              const key = `${item.domain}:${normalize(item.title)}`;
              const isSaved = savedItems.has(key);
              return (
                <article key={key} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="font-medium">{item.title}</h4>
                      <p className="mt-1 text-sm text-muted">{item.why_it_may_apply}</p>
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={() => void addOne(item)} disabled={isSaved || create.isPending}>
                      {isSaved ? "Already in My Plan" : "Add to My Plan"}
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    <span className="font-medium text-fg">{domainLabel(item.domain)}</span>
                    {item.topic && ` · ${item.topic}`}
                    {item.source_type && ` · ${item.source_type}`}
                    {item.effective_date && ` · Effective ${item.effective_date}`}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      )}

      <Dialog open={confirmingAll} onOpenChange={setConfirmingAll}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add all checklist items?</DialogTitle>
            <DialogDescription>
              This adds {remaining.length} item{remaining.length === 1 ? "" : "s"} to My Plan. Items already there will be skipped.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmingAll(false)}>Cancel</Button>
            <Button type="button" onClick={() => void addAll()} disabled={create.isPending}>Add all</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
