"use client";

import { useEffect, useState } from "react";

/** Tracks `prefers-reduced-motion: reduce`. Recharts animates via JS/SMIL, which
 *  the global CSS reduced-motion reset can't reach — charts must gate their own
 *  `isAnimationActive` on this. SSR-safe (defaults to "no preference"). */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return reduced;
}
