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

// Bearer-authenticated auth calls (MFA management, /auth/me). These go through the
// same same-origin proxy as the cookie flows, but carry the in-memory access token.
async function bearerFetch(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers();
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  const token = authStore.access;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${authBase}${path}`, {
    method: init.method ?? "GET",
    credentials: "include",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

// `detail` carries the server's own message on failure. Signup needs it: an
// invite code that is unknown, spent or expired is a 400 whose reason only the
// server knows, and a generic "account creation failed" would send someone to
// re-check their password instead of their code.
export type AuthResult = { ok: boolean; status: number; detail?: string };

async function detailOf(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.clone().json()) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : undefined;
  } catch {
    return undefined;
  }
}

export type Me = {
  id: string;
  email: string;
  display_name: string | null;
  email_verified: boolean;
  mfa_enabled: boolean;
};

export type MfaStatus = { mfa_enabled: boolean; unused_recovery_codes: number };
export type MfaEnrollment = { secret: string; otpauth_uri: string };

export const authApi = {
  async login(body: Record<string, unknown>): Promise<AuthResult> {
    const res = await authFetch("/auth/login", body);
    if (res.ok) authStore.set((await res.json()) as AccessToken);
    return { ok: res.ok, status: res.status };
  },
  async signup(body: Record<string, unknown>): Promise<AuthResult> {
    const res = await authFetch("/auth/signup", body);
    if (res.ok) {
      authStore.set((await res.json()) as AccessToken);
      return { ok: true, status: res.status };
    }
    return { ok: false, status: res.status, detail: await detailOf(res) };
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

  // --- Account recovery ---
  // The request endpoint always reports success so this screen can never be used
  // to discover which addresses have accounts.
  async requestPasswordReset(email: string): Promise<AuthResult> {
    const res = await authFetch("/auth/password-reset/request", { email });
    return { ok: res.ok, status: res.status };
  },
  async confirmPasswordReset(token: string, newPassword: string): Promise<AuthResult> {
    const res = await authFetch("/auth/password-reset/confirm", {
      token,
      new_password: newPassword,
    });
    // Every session was revoked server-side, so drop any token held here too.
    if (res.ok) authStore.clear();
    return { ok: res.ok, status: res.status };
  },
  async confirmEmailVerification(token: string): Promise<AuthResult> {
    const res = await authFetch("/auth/verify-email/confirm", { token });
    return { ok: res.ok, status: res.status };
  },
  async requestEmailVerification(): Promise<AuthResult> {
    const res = await bearerFetch("/auth/verify-email/request", { method: "POST" });
    return { ok: res.ok, status: res.status };
  },

  async me(): Promise<Me | null> {
    const res = await bearerFetch("/auth/me");
    return res.ok ? ((await res.json()) as Me) : null;
  },

  // --- MFA ---
  async mfaStatus(): Promise<MfaStatus | null> {
    const res = await bearerFetch("/auth/mfa/status");
    return res.ok ? ((await res.json()) as MfaStatus) : null;
  },
  async mfaEnroll(): Promise<MfaEnrollment | null> {
    const res = await bearerFetch("/auth/mfa/enroll", { method: "POST" });
    return res.ok ? ((await res.json()) as MfaEnrollment) : null;
  },
  // Returns the recovery codes, which the server will never show again.
  async mfaVerify(totpCode: string): Promise<string[] | null> {
    const res = await bearerFetch("/auth/mfa/verify", {
      method: "POST",
      body: { totp_code: totpCode },
    });
    return res.ok ? ((await res.json()).recovery_codes as string[]) : null;
  },
  async regenerateRecoveryCodes(): Promise<string[] | null> {
    const res = await bearerFetch("/auth/mfa/recovery-codes", { method: "POST" });
    return res.ok ? ((await res.json()).recovery_codes as string[]) : null;
  },
};

// Restore the in-memory access token on app load using the refresh cookie.
export async function ensureSession(): Promise<boolean> {
  if (authStore.isAuthenticated()) return true;
  return authApi.refresh();
}
