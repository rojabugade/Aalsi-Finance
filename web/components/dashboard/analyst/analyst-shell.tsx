"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { AnalystBlob } from "./analyst-blob";
import { AnalystPane } from "./analyst-pane";
import { useAnalyst } from "./use-analyst";

/** Human label for the analyst's "what page am I on" context, by first path segment. */
const PAGE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  transactions: "Spend",
  insights: "Insights",
  activity: "Activity",
  guidance: "Guidance",
  "cross-border": "Cross-border",
  connections: "Connections",
  "review-queue": "Review queue",
  settings: "Settings",
  debt: "Debt",
  cards: "Cards",
  money: "Money",
};

export function pageLabelFromPath(pathname: string): string {
  const seg = pathname.replace(/^\/+/, "").split("/")[0] ?? "";
  return PAGE_LABELS[seg] ?? (seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : "Dashboard");
}

/** Mounted once inside AnalystProvider (in the app shell). Keeps the analyst's
 *  page context in sync with the route and renders the floating FAB + pane on
 *  every authenticated page. */
export function AnalystShell() {
  const { setPage, setRoute } = useAnalyst();
  const pathname = usePathname();

  useEffect(() => {
    setPage(pageLabelFromPath(pathname));
    setRoute(pathname);
  }, [pathname, setPage, setRoute]);

  return (
    <>
      <AnalystBlob />
      <AnalystPane />
    </>
  );
}
