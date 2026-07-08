"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

import { useAsk, useWizard } from "@/lib/api/guidance";
import { Citations, DictList } from "@/components/guidance/citations";
import { CrossBorderModule } from "@/components/guidance/cross-border-module";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

export default function GuidancePage() {
  // Shell top tabs: Ask (/guidance) and Plan (/guidance?tab=plan).
  const onPlan = useSearchParams().get("tab") === "plan";
  // Within Plan, a sub-toggle switches between the wizard and cross-border tools.
  const [planView, setPlanView] = useState<"wizard" | "cross-border">("wizard");

  if (!onPlan) return <AskPanel />;

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-full bg-chip p-0.5">
        {(
          [
            ["wizard", "Planner"],
            ["cross-border", "Cross-border"],
          ] as ["wizard" | "cross-border", string][]
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setPlanView(value)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
              planView === value ? "bg-card text-fg shadow-card" : "text-muted hover:text-fg",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {planView === "wizard" ? <WizardPanel /> : <CrossBorderModule />}
    </div>
  );
}

function AskPanel() {
  const ask = useAsk();
  const [crossBorder, setCrossBorder] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const country = String(form.get("country") ?? "").trim();
    const topic = String(form.get("topic") ?? "").trim();
    ask.mutate({
      crossBorder,
      body: {
        question: String(form.get("question") ?? ""),
        country: country || null,
        topic: topic || null,
      },
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
        <div className="mb-3">
          <h2 className="text-base font-bold tracking-tight">Ask a question</h2>
          <p className="text-sm text-muted">Answers are grounded in cited source documents.</p>
        </div>
        <div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="question">Question</Label>
              <Textarea id="question" name="question" rows={3} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="country">Country (optional)</Label>
                <Input id="country" name="country" maxLength={2} placeholder="US" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="topic">Topic (optional)</Label>
                <Input id="topic" name="topic" placeholder="taxes" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={crossBorder}
                onChange={(e) => setCrossBorder(e.target.checked)}
              />
              Cross-border specialised
            </label>
            <Button type="submit" disabled={ask.isPending}>
              {ask.isPending ? "Thinking…" : "Ask"}
            </Button>
          </form>
        </div>
      </div>

      {ask.isPending && <Skeleton className="h-40" />}
      {ask.isError && (
        <div className="rounded-card-sm border border-border bg-card p-6 text-sm text-destructive shadow-card">
          Couldn&apos;t get an answer. Try again.
        </div>
      )}
      {ask.data && (
        <div className="space-y-4 rounded-card-sm border border-border bg-card p-6 shadow-card">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{ask.data.answer}</p>
          <Citations citations={ask.data.citations} />
          <p className="text-xs text-muted">{ask.data.disclaimer}</p>
        </div>
      )}
    </div>
  );
}

function WizardPanel() {
  const wizard = useWizard();
  const [crossBorder, setCrossBorder] = useState(true);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const list = (k: string) =>
      String(form.get(k) ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const amount = String(form.get("annual_transfer_amount") ?? "").trim();
    const currency = String(form.get("transfer_currency") ?? "").trim();
    const residency = String(form.get("residency") ?? "").trim();
    wizard.mutate({
      crossBorder,
      body: {
        countries: list("countries").length ? list("countries") : ["US", "IN"],
        residency: residency || null,
        annual_transfer_amount: amount || null,
        transfer_currency: currency || null,
        account_types: list("account_types"),
      },
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
        <div className="mb-3">
          <h2 className="text-base font-bold tracking-tight">Planning wizard</h2>
          <p className="text-sm text-muted">Generates a checklist and reminders for your situation.</p>
        </div>
        <div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="countries">Countries (comma-separated)</Label>
                <Input id="countries" name="countries" defaultValue="US, IN" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="residency">Residency</Label>
                <Input id="residency" name="residency" placeholder="US resident" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="annual_transfer_amount">Annual transfer amount</Label>
                <Input
                  id="annual_transfer_amount"
                  name="annual_transfer_amount"
                  type="number"
                  min="0"
                  step="0.01"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="transfer_currency">Transfer currency</Label>
                <Input id="transfer_currency" name="transfer_currency" maxLength={3} placeholder="USD" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="account_types">Account types (comma-separated)</Label>
              <Input id="account_types" name="account_types" placeholder="checking, brokerage" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={crossBorder}
                onChange={(e) => setCrossBorder(e.target.checked)}
              />
              Cross-border specialised
            </label>
            <Button type="submit" disabled={wizard.isPending}>
              {wizard.isPending ? "Building…" : "Build plan"}
            </Button>
          </form>
        </div>
      </div>

      {wizard.isPending && <Skeleton className="h-48" />}
      {wizard.isError && (
        <div className="rounded-card-sm border border-border bg-card p-6 text-sm text-destructive shadow-card">
          Couldn&apos;t build a plan. Try again.
        </div>
      )}
      {wizard.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
            <div className="mb-3">
              <h2 className="text-base font-bold tracking-tight">Checklist</h2>
            </div>
            <div>
              <DictList items={wizard.data.checklist as Record<string, unknown>[]} />
            </div>
          </div>
          <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
            <div className="mb-3">
              <h2 className="text-base font-bold tracking-tight">Reminders</h2>
            </div>
            <div className="space-y-4">
              <DictList items={wizard.data.reminders as Record<string, unknown>[]} />
              <Citations citations={wizard.data.citations} />
              <p className="text-xs text-muted">{wizard.data.disclaimer}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
