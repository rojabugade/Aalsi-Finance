// Closed-beta endpoints.
//
// Plain fetch rather than the generated openapi-fetch client: two of these three
// are unauthenticated and called from the public marketing page, which has no
// session to attach, and routing them same-origin through the Next rewrite (as
// /auth/* already does) avoids needing CORS for a form anyone can submit.

import { useQuery } from "@tanstack/react-query";

import { authStore } from "./auth";

// Empty in the browser => same-origin => Next rewrites /beta/* to the API.
const base =
  typeof window === "undefined"
    ? (process.env.API_INTERNAL_URL ??
      process.env.NEXT_PUBLIC_API_URL ??
      "http://localhost:8000")
    : "";

export type BetaApplication = {
  email: string;
  name?: string | null;
  country?: string | null;
  how_you_track_money?: string | null;
};

export type Allowance = {
  used: number;
  limit: number;
  remaining: number;
  next_credit_at: string | null;
};

export type BetaUsage = {
  active: boolean;
  ai_requests: Allowance;
  documents: Allowance;
  ai_daily_cost_limit_usd: number;
  ai_requests_per_minute: number;
};

export type ApplyResult = { ok: boolean; status: number };

export async function applyForBeta(body: BetaApplication): Promise<ApplyResult> {
  const res = await fetch(`${base}/beta/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status };
}

export async function fetchBetaStatus(): Promise<{ invite_required: boolean }> {
  const res = await fetch(`${base}/beta/status`);
  // A failure here must not stop someone signing up: the server enforces the
  // gate regardless, so the worst case of assuming "not required" is a 400 with
  // a message that says exactly what's missing.
  if (!res.ok) return { invite_required: false };
  return (await res.json()) as { invite_required: boolean };
}

export function useBetaUsage() {
  return useQuery<BetaUsage>({
    queryKey: ["beta", "usage"],
    queryFn: async () => {
      const token = authStore.access;
      const res = await fetch(`${base}/beta/usage`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
      if (!res.ok) throw new Error(`beta usage: ${res.status}`);
      return (await res.json()) as BetaUsage;
    },
    // Counts move as the person uses the app, but not fast enough to poll.
    staleTime: 30_000,
    retry: false,
  });
}
