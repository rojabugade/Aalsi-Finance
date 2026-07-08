"use client";

import { useEffect } from "react";

export function SwRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      // Self-heal: a SW registered by a past production run keeps serving its
      // stale precache over the dev server. Tear down any stray SW + caches.
      navigator.serviceWorker.getRegistrations().then((regs) =>
        regs.forEach((r) => r.unregister()),
      );
      if (typeof caches !== "undefined") {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
      }
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch((err) =>
      console.warn("SW registration failed", err),
    );
  }, []);
  return null;
}
