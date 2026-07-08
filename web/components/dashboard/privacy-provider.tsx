"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { PrivacyLevel } from "@/lib/dashboard/boards";
import { maskMoney, shouldHoverReveal } from "@/lib/dashboard/privacy";

const PrivacyContext = createContext<{ level: PrivacyLevel }>({ level: "off" });

export function PrivacyProvider({ level, children }: { level: PrivacyLevel; children: ReactNode }) {
  return <PrivacyContext.Provider value={{ level }}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy() {
  return useContext(PrivacyContext);
}

/**
 * Wraps a sensitive value. Off → passthrough. Privacy → masked by default,
 * revealed on hover. Presentation/Screenshot → masked, no reveal.
 */
export function Private({ kind = "text", children }: { kind?: "money" | "name" | "text"; children: ReactNode }) {
  const { level } = usePrivacy();
  if (level === "off") return <>{children}</>;

  const masked = kind === "money"
    ? (typeof children === "string" ? maskMoney(children, level) : "•••••")
    : "•••";

  if (shouldHoverReveal(level)) {
    return (
      <span className="group/pv relative inline-flex cursor-default items-center" data-private={kind}>
        <span className="transition-opacity group-hover/pv:opacity-0">{masked}</span>
        <span className="pointer-events-none absolute inset-0 inline-flex items-center opacity-0 transition-opacity group-hover/pv:opacity-100">{children}</span>
      </span>
    );
  }

  return <span data-private={kind}>{masked}</span>;
}
