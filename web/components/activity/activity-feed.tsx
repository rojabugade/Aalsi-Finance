"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useNotifications, useMarkRead } from "@/lib/api/notifications";
import { present, GROUP_ORDER, UPCOMING_TYPES, type PresentedActivity } from "@/lib/activity/present";
import { Skeleton } from "@/components/ui/skeleton";

export function ActivityFeed() {
  const q = useNotifications();
  const markRead = useMarkRead();

  const { upcoming, groups } = useMemo(() => {
    const all = q.data ?? [];
    const upcoming = all.filter((n) => UPCOMING_TYPES.has(n.type)).map(present);
    const items = all.filter((n) => !UPCOMING_TYPES.has(n.type)).map(present);
    const groups = GROUP_ORDER.map((g) => ({ group: g, items: items.filter((i) => i.group === g) })).filter(
      (x) => x.items.length > 0,
    );
    return { upcoming, groups };
  }, [q.data]);

  if (q.isError) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-destructive shadow-card">
        Couldn&apos;t load activity.
      </div>
    );
  }
  if (q.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }
  if (upcoming.length === 0 && groups.length === 0) {
    return (
      <div
        className="rounded-2xl border border-border bg-card py-16 text-center text-sm text-muted shadow-card"
        data-testid="activity-empty"
      >
        You&apos;re all caught up.
      </div>
    );
  }

  return (
    <>
      {upcoming.length > 0 && (
        <section className="space-y-2" data-testid="upcoming-payments">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted">Upcoming payments</h3>
          <div className="rounded-2xl border border-border bg-card p-1 shadow-card">
            {upcoming.map((it) => (
              <Row key={it.id} it={it} onView={() => markRead.mutate(it.id)} />
            ))}
          </div>
        </section>
      )}
      <div className="space-y-5" data-testid="activity-feed">
        {groups.map(({ group, items }) => (
          <section key={group} className="space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted">{group}</h3>
            <div className="rounded-2xl border border-border bg-card p-1 shadow-card">
              {items.map((it) => (
                <Row key={it.id} it={it} onView={() => markRead.mutate(it.id)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function Row({ it, onView }: { it: PresentedActivity; onView: () => void }) {
  const Icon = it.icon;
  return (
    <Link
      href={it.href}
      onClick={() => it.unread && onView()}
      className="flex items-start gap-3 rounded-xl px-2 py-2.5 hover:bg-chip"
    >
      <span className="grid size-9 flex-none place-items-center rounded-xl bg-accent-soft text-accent">
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold">{it.title}</span>
          {it.unread && <span className="size-1.5 rounded-full bg-accent" aria-label="unread" />}
        </span>
        {it.detail && <span className="block truncate text-xs text-muted">{it.detail}</span>}
      </span>
      <span className="text-muted">›</span>
    </Link>
  );
}
