"use client";

import type { Loan, LoanIn } from "@/lib/api/loans";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { COMMON_CURRENCIES } from "@/lib/constants/currencies";

export function loanToFormDefaults(loan?: Loan): Record<string, string> {
  return {
    name: loan?.name ?? "",
    type: loan?.type ?? "other",
    schedule_kind: loan?.schedule_kind ?? "amortizing",
    principal: loan?.principal != null ? String(loan.principal) : "",
    currency: loan?.currency ?? "USD",
    interest_rate: loan?.interest_rate != null ? String(loan.interest_rate) : "",
    min_or_emi_amount:
      loan?.min_or_emi_amount != null ? String(loan.min_or_emi_amount) : "",
    due_day: loan?.due_day != null ? String(loan.due_day) : "",
    start_date: loan?.start_date ?? "",
  };
}

export function formToLoanIn(form: FormData): LoanIn {
  const str = (k: string) => {
    const v = String(form.get(k) ?? "").trim();
    return v || null;
  };
  return {
    name: String(form.get("name") ?? ""),
    type: String(form.get("type") ?? "other"),
    schedule_kind: String(form.get("schedule_kind") ?? "amortizing"),
    principal: String(form.get("principal") ?? "0"),
    currency: String(form.get("currency") ?? "USD"),
    interest_rate: str("interest_rate"),
    compounding: "monthly",
    min_or_emi_amount: str("min_or_emi_amount"),
    due_day: form.get("due_day") ? Number(form.get("due_day")) : null,
    start_date: str("start_date"),
  } as LoanIn;
}

export function LoanForm({
  loan,
  onSubmit,
  pending,
  submitLabel,
}: {
  loan?: Loan;
  onSubmit: (payload: LoanIn) => void;
  pending: boolean;
  submitLabel: string;
}) {
  const d = loanToFormDefaults(loan);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(formToLoanIn(new FormData(e.currentTarget)));
      }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <Label htmlFor="name" required>Name</Label>
        <Input id="name" name="name" defaultValue={d.name} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="type">Type</Label>
          <NativeSelect id="type" name="type" defaultValue={d.type}>
            <option value="home">Mortgage / Home</option>
            <option value="auto">Auto</option>
            <option value="education">Student</option>
            <option value="personal">Personal</option>
            <option value="credit_card">Credit card</option>
            <option value="other">Other</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="schedule_kind">Schedule</Label>
          <NativeSelect id="schedule_kind" name="schedule_kind" defaultValue={d.schedule_kind}>
            <option value="amortizing">Amortizing</option>
            <option value="emi">EMI</option>
            <option value="revolving">Revolving</option>
          </NativeSelect>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="principal" required>Principal</Label>
          <Input id="principal" name="principal" type="number" inputMode="decimal" min="0" step="0.01" defaultValue={d.principal} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="currency">Currency</Label>
          <NativeSelect id="currency" name="currency" defaultValue={d.currency || "USD"}>
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="interest_rate">Interest rate %</Label>
          <Input id="interest_rate" name="interest_rate" type="number" inputMode="decimal" min="0" step="0.01" defaultValue={d.interest_rate} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="min_or_emi_amount">Min / EMI payment</Label>
          <Input id="min_or_emi_amount" name="min_or_emi_amount" type="number" inputMode="decimal" min="0" step="0.01" defaultValue={d.min_or_emi_amount} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="due_day">Due day (1-31)</Label>
          <Input id="due_day" name="due_day" type="number" inputMode="numeric" min="1" max="31" defaultValue={d.due_day} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="start_date">Start date</Label>
          <Input id="start_date" name="start_date" type="date" defaultValue={d.start_date} />
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
