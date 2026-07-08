"use client";

import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-c2 px-4 py-1.5 text-center text-xs font-semibold text-white"
      style={{ paddingTop: "max(0.375rem, env(safe-area-inset-top))" }}
    >
      <CloudOff className="size-3.5" />
      Offline — captures will sync when you reconnect
    </div>
  );
}
