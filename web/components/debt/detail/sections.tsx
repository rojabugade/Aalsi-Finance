"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  useCreatePayment,
  useDeleteLoan,
  useDeletePayment,
  useLoanPayments,
  useLoanSchedule,
  usePatchLoan,
  usePayoffCalc,
  type Loan,
} from "@/lib/api/loans";
import { formatCurrency, formatDateShort, formatRelativeDueDate } from "@/lib/format";
import { LoanForm } from "@/components/debt/loan-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE = 12;
const PEEK = 3;

export function HeaderStats({ loan, onEdit }: { loan: Loan; onEdit: () => void }) {
  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Metric label="Outstanding" value={formatCurrency(loan.outstanding_balance ?? loan.principal, { currency: loan.currency })} />
        <Metric label="Paid to date" value={formatCurrency(loan.total_paid ?? 0, { currency: loan.currency })} />
        <Metric label="Interest paid" value={formatCurrency(loan.total_interest_paid ?? 0, { currency: loan.currency })} />
        <Metric label="Next due" value={loan.next_due_date ? formatRelativeDueDate(loan.next_due_date) : "—"} />
      </div>
      <Button variant="outline" onClick={onEdit}>Edit loan</Button>
    </section>
  );
}

export function PaymentHistory({ loan }: { loan: Loan }) {
  const [offset, setOffset] = useState(0);
  const payments = useLoanPayments(loan.id, { limit: PAGE, offset });
  const create = useCreatePayment();
  const del = useDeletePayment();
  const total = payments.data?.total ?? 0;
  const items = payments.data?.items ?? [];

  async function onLog(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await create.mutateAsync({
        id: loan.id,
        body: {
          payment_date: String(form.get("payment_date") ?? ""),
          amount: String(form.get("amount") ?? "0"),
          note: String(form.get("note") ?? "").trim() || null,
        },
      });
      setOffset(0);
      toast.success("Payment logged");
      e.currentTarget.reset();
    } catch {
      toast.error("Couldn't log payment");
    }
  }

  return (
    <details className="group rounded-lg border border-border" >
      <summary className="cursor-pointer list-none p-3 text-sm font-semibold">
        Payment history{total ? ` (${total})` : ""}
        <span className="ml-1 text-xs font-normal text-muted group-open:hidden">— tap to expand</span>
      </summary>
      <div className="space-y-4 border-t border-border p-3">
        <form onSubmit={onLog} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="payment_date">Date</Label>
            <Input id="payment_date" name="payment_date" type="date" required className="w-40" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="amount">Amount</Label>
            <Input id="amount" name="amount" type="number" min="0" step="0.01" required className="w-32" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="note">Note</Label>
            <Input id="note" name="note" className="w-40" />
          </div>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Logging..." : "Log payment"}
          </Button>
        </form>

        {payments.isLoading ? (
          <Skeleton className="h-32" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">No payments recorded yet.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Principal</TableHead>
                  <TableHead className="text-right">Interest</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.payment_date}</TableCell>
                    <TableCell data-numeric className="text-right">{formatCurrency(p.amount, { currency: loan.currency })}</TableCell>
                    <TableCell data-numeric className="text-right">{formatCurrency(p.principal_component ?? 0, { currency: loan.currency })}</TableCell>
                    <TableCell data-numeric className="text-right">{formatCurrency(p.interest_component ?? 0, { currency: loan.currency })}</TableCell>
                    <TableCell data-numeric className="text-right">{formatCurrency(p.balance_after ?? 0, { currency: loan.currency })}</TableCell>
                    <TableCell className="text-right">
                      <button
                        type="button"
                        className="text-xs text-destructive hover:underline disabled:opacity-50"
                        disabled={del.isPending}
                        onClick={() => del.mutate({ id: loan.id, paymentId: p.id })}
                      >
                        Delete
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {total > PAGE && (
              <div className="flex items-center justify-between text-sm">
                <Button variant="outline" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE))}>
                  Previous
                </Button>
                <span className="text-muted">
                  {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
                </span>
                <Button variant="outline" disabled={offset + PAGE >= total} onClick={() => setOffset((o) => o + PAGE)}>
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}

export function UpcomingSchedule({ loan }: { loan: Loan }) {
  const schedule = useLoanSchedule(loan.id);
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const rows = schedule.data ?? [];
  const total = rows.length;
  const visible = expanded
    ? rows.slice(page * PAGE, page * PAGE + PAGE)
    : rows.slice(0, PEEK);

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Upcoming schedule</h3>
      {schedule.isLoading ? (
        <Skeleton className="h-48" />
      ) : total === 0 ? (
        <p className="text-sm text-muted">No upcoming installments — loan is paid off.</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Principal</TableHead>
                <TableHead className="text-right">Interest</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.installment_no}</TableCell>
                  <TableCell>
                    <span className="font-medium">{formatRelativeDueDate(r.due_date)}</span>
                    <span data-numeric className="block text-[11px] text-muted">{formatDateShort(r.due_date)}</span>
                  </TableCell>
                  <TableCell data-numeric className="text-right">{formatCurrency(r.principal_component, { currency: loan.currency })}</TableCell>
                  <TableCell data-numeric className="text-right">{formatCurrency(r.interest_component, { currency: loan.currency })}</TableCell>
                  <TableCell data-numeric className="text-right">{formatCurrency(r.balance_after, { currency: loan.currency })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {!expanded && total > PEEK && (
            <Button variant="outline" onClick={() => { setExpanded(true); setPage(0); }}>
              Show all ({total})
            </Button>
          )}

          {expanded && (
            <div className="space-y-2">
              {total > PAGE && (
                <div className="flex items-center justify-between text-sm">
                  <Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                    Previous
                  </Button>
                  <span className="text-muted">
                    {page * PAGE + 1}–{Math.min(page * PAGE + PAGE, total)} of {total}
                  </span>
                  <Button variant="outline" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              )}
              <Button variant="ghost" onClick={() => { setExpanded(false); setPage(0); }}>
                Show less
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function PayoffCalculator({ loan }: { loan: Loan }) {
  const calc = usePayoffCalc();
  async function onCalc(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    calc.mutate({ id: loan.id, body: { monthly_payment: String(form.get("monthly_payment") ?? "0") } });
  }
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Payoff calculator</h3>
      <form onSubmit={onCalc} className="flex items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="monthly_payment">Monthly payment</Label>
          <Input id="monthly_payment" name="monthly_payment" type="number" min="0" step="0.01" required className="w-40" />
        </div>
        <Button type="submit" disabled={calc.isPending}>
          {calc.isPending ? "Calculating..." : "Calculate"}
        </Button>
      </form>
      {calc.isError && <p className="text-sm text-destructive">Couldn&apos;t calculate payoff.</p>}
      {calc.data && (
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Metric label="Months" value={String(calc.data.months)} />
          <Metric label="Total interest" value={formatCurrency(calc.data.total_interest, { currency: loan.currency })} />
          <Metric label="Total paid" value={formatCurrency(calc.data.total_paid, { currency: loan.currency })} />
        </div>
      )}
      {calc.data?.warning && <p className="text-sm text-c2">{calc.data.warning}</p>}
    </section>
  );
}

export function EditSection({ loan, onDone, onDeleted }: { loan: Loan; onDone: () => void; onDeleted: () => void }) {
  const patch = usePatchLoan();
  const del = useDeleteLoan();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Edit loan</h3>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
      <LoanForm
        loan={loan}
        pending={patch.isPending}
        submitLabel="Save changes"
        onSubmit={async (payload) => {
          try {
            await patch.mutateAsync({ id: loan.id, body: payload });
            toast.success("Loan updated");
            onDone();
          } catch {
            toast.error("Couldn't update loan");
          }
        }}
      />
      <div className="border-t border-border pt-4">
        {confirming ? (
          <div className="flex items-center gap-3">
            <p className="text-sm text-destructive">Delete this loan and its history?</p>
            <Button
              variant="destructive"
              disabled={del.isPending}
              onClick={async () => {
                try {
                  await del.mutateAsync(loan.id);
                  toast.success("Loan deleted");
                  onDeleted();
                } catch {
                  toast.error("Couldn't delete loan");
                }
              }}
            >
              Confirm delete
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        ) : (
          <Button variant="outline" className="text-destructive" onClick={() => setConfirming(true)}>
            Delete loan
          </Button>
        )}
      </div>
    </div>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted">{label}</p>
      <p data-numeric className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
