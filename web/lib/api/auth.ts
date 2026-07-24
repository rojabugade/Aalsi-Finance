// Auth token handling for the cookie-based flow.
//
// The refresh token lives only in an httpOnly cookie the browser sends automatically;
// JS never sees it. The access token is kept in memory (not localStorage) so an XSS
// can't read a long-lived credential. On reload, memory is empty and the session is
// rebootstrapped by calling /auth/refresh with the cookie (see ensureSession).
//
// Auth calls go same-origin (empty base in the browser) so they route through the Next
// /api proxy — that makes the httpOnly refresh cookie and the readable CSRF cookie
// belong to the SPA origin, so document.cookie can read the CSRF token to echo it back
// (double-submit). Data calls keep hitting the API directly with the Bearer token.

const SERVER_AUTH_BASE =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
// Empty in the browser => same-origin => Next rewrites /auth/* and /workspace/* to the API.
const authBase = typeof window === "undefined" ? SERVER_AUTH_BASE : "";

const CSRF_COOKIE = "cbf_csrf";
const CSRF_HEADER = "X-CSRF-Token";

export type AccessToken = { access_token: string; token_type?: string };
// Legacy alias: callers still import `TokenPair`; there's no refresh_token in it anymore.
export type TokenPair = AccessToken;

let accessToken: string | null = null;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export const authStore = {
  get access() {
    return accessToken;
  },
  // Legacy alias used by the older client.
  get accessToken() {
    return accessToken;
  },
  get csrf() {
    return readCookie(CSRF_COOKIE);
  },
  isAuthenticated() {
    return Boolean(accessToken);
  },
  set(tokens: AccessToken | null) {
    accessToken = tokens?.access_token ?? null;
  },
  setAccess(token: string | null) {
    accessToken = token;
  },
  clear() {
    accessToken = null;
  },
};

function authFetch(path: string, body?: unknown, withCsrf = false): Promise<Response> {
  const headers = new Headers();
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (withCsrf) {
    const csrf = authStore.csrf;
    if (csrf) headers.set(CSRF_HEADER, csrf);
  }
  return fetch(`${authBase}${path}`, {
    method: "POST",
    credentials: "include", // send + receive the auth cookies
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export type AuthResult = { ok: boolean; status: number };

export const authApi = {
  async login(body: Record<string, unknown>): Promise<AuthResult> {
    const res = await authFetch("/auth/login", body);
    if (res.ok) authStore.set((await res.json()) as AccessToken);
    return { ok: res.ok, status: res.status };
  },
  async signup(body: Record<string, unknown>): Promise<AuthResult> {
    const res = await authFetch("/auth/signup", body);
    if (res.ok) authStore.set((await res.json()) as AccessToken);
    return { ok: res.ok, status: res.status };
  },
  // Uses the httpOnly refresh cookie + CSRF header. Returns whether a session is live.
  async refresh(): Promise<boolean> {
    const res = await authFetch("/auth/refresh", undefined, true);
    if (!res.ok) {
      authStore.clear();
      return false;
    }
    authStore.set((await res.json()) as AccessToken);
    return true;
  },
  async logout(): Promise<void> {
    try {
      await authFetch("/auth/logout", undefined, true);
    } catch {
      /* Local sign-out must complete even if the API is unreachable. */
    }
    authStore.clear();
  },
};

// Restore the in-memory access token on app load using the refresh cookie.
export async function ensureSession(): Promise<boolean> {
  if (authStore.isAuthenticated()) return true;
  return authApi.refresh();
}
