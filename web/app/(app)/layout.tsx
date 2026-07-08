"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ensureSession } from "@/lib/api/auth";
import { AppShell } from "@/components/shell/app-shell";
import { presetRange } from "@/lib/dates";
import { AnalystProvider } from "@/components/dashboard/analyst/use-analyst";
import { AnalystShell } from "@/components/dashboard/analyst/analyst-shell";
import { makeGlobalActionHandler } from "@/components/dashboard/analyst/global-action-handler";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Access token lives in memory, so on reload we rebootstrap the session from the
    // httpOnly refresh cookie before deciding whether to show the app or redirect.
    let active = true;
    (async () => {
      const ok = await ensureSession();
      if (!active) return;
      if (ok) setReady(true);
      else router.replace("/login");
    })();
    return () => {
      active = false;
    };
  }, [router]);

  const onAction = useMemo(() => makeGlobalActionHandler({ router }), [router]);

  if (!ready) return null;

  return (
    <AnalystProvider defaultRange={presetRange("90d")} onAction={onAction}>
      <AppShell>{children}</AppShell>
      <AnalystShell />
    </AnalystProvider>
  );
}
