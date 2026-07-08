import type { Notification } from "@/lib/api/notifications";
import { AlertTriangle, Bell, CalendarClock, FileText, Globe } from "@/lib/icons";
import type { LucideIcon } from "lucide-react";

export type ActivityGroup = "Today" | "This week" | "Earlier";

export type PresentedActivity = {
  id: string;
  title: string;
  detail: string;
  icon: LucideIcon;
  href: string;
  group: ActivityGroup;
  unread: boolean;
};

type Payload = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const day = (v: unknown) => str(v).slice(0, 10);

/**
 * Maps each backend notification `type` (see backend/app/notifications/service.py)
 * to a human title, icon, deep-link, and a plain-language detail built from the
 * structured payload — never a raw dump of UUIDs.
 */
const MAP: Record<
  string,
  { title: string; icon: LucideIcon; href: string; detail: (p: Payload) => string }
> = {
  budget_overspend: {
    title: "Budget exceeded",
    icon: AlertTriangle,
    href: "/budgets",
    detail: (p) => `You've spent ${str(p.spent)} of a ${str(p.amount)} budget.`,
  },
  loan_due: {
    title: "Payment due",
    icon: CalendarClock,
    href: "/debt",
    detail: (p) => (p.due_date ? `Installment ${str(p.installment_no)} due ${day(p.due_date)}.` : "A loan payment is coming up."),
  },
  loan_penalty_risk: {
    title: "Late-payment risk",
    icon: AlertTriangle,
    href: "/debt",
    detail: (p) => (p.due_date ? `Pay before ${day(p.due_date)} to avoid a penalty.` : "A penalty may apply soon."),
  },
  document_review: {
    title: "Receipt needs review",
    icon: FileText,
    href: "/review",
    detail: () => "A captured document is waiting for your review.",
  },
  cross_border_reminder: {
    title: "Cross-border transfer",
    icon: Globe,
    href: "/transactions?view=all",
    detail: (p) => (p.purpose ? `Recent transfer · ${str(p.purpose)}.` : "You have a recent cross-border transfer."),
  },
};

function groupFor(dateStr: string | null | undefined): ActivityGroup {
  if (!dateStr) return "Earlier";
  const d = new Date(dateStr).getTime();
  if (Number.isNaN(d)) return "Earlier";
  const days = (Date.now() - d) / 86_400_000;
  if (days < 1) return "Today";
  if (days < 7) return "This week";
  return "Earlier";
}

export function present(n: Notification): PresentedActivity {
  const payload = (n.payload ?? {}) as Payload;
  const m = MAP[n.type];
  return {
    id: n.id,
    title: m ? m.title : n.type.replace(/_/g, " "),
    detail: m ? m.detail(payload) : "",
    icon: m ? m.icon : Bell,
    href: m ? m.href : "/notifications",
    group: groupFor(n.scheduled_for ?? null),
    unread: n.status !== "read",
  };
}

/** Forecast-type notifications: pinned in the Upcoming strip, kept out of history. */
export const UPCOMING_TYPES = new Set(["loan_due", "loan_penalty_risk"]);

export const GROUP_ORDER: ActivityGroup[] = ["Today", "This week", "Earlier"];
