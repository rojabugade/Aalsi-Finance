import { authApi, authStore } from "./api/auth";

export { authStore };
export type { TokenPair } from "./api/auth";

export type ApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number; missing?: boolean; unauthorized?: boolean };

const BROWSER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const SERVER_API_URL = process.env.API_INTERNAL_URL ?? BROWSER_API_URL;
const API_URL = typeof window === "undefined" ? SERVER_API_URL : BROWSER_API_URL;

function authHeaders(init?: HeadersInit) {
  const headers = new Headers(init);
  const token = authStore.access;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function parseError(res: Response) {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail)) return body.detail.map((item: unknown) => JSON.stringify(item)).join("; ");
    return JSON.stringify(body);
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

async function rawRequest(path: string, init: RequestInit = {}) {
  const headers = authHeaders(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${API_URL}${path}`, { ...init, headers, credentials: "include" });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await rawRequest(path, init);
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status} ${await parseError(res)}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function tryRequest<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await rawRequest(path, init);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: await parseError(res),
        missing: res.status === 404 || res.status === 405,
        unauthorized: res.status === 401 || res.status === 403,
      };
    }
    const data = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
    return { ok: true, data, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : "Network error" };
  }
}

function json(method: string, body?: unknown): RequestInit {
  return { method, body: body === undefined ? undefined : JSON.stringify(body) };
}

export const api = {
  baseUrl: API_URL,
  health: () => request<{ status: string }>("/health"),
  version: () => request<{ version: string; commit?: string }>("/version"),
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, json("POST", body)),
  patch: <T>(path: string, body?: unknown) => request<T>(path, json("PATCH", body)),
  put: <T>(path: string, body?: unknown) => request<T>(path, json("PUT", body)),
  delete: <T>(path: string, body?: unknown) => request<T>(path, json("DELETE", body)),
  tryGet: <T>(path: string) => tryRequest<T>(path),
  tryPost: <T>(path: string, body?: unknown) => tryRequest<T>(path, json("POST", body)),
  tryPut: <T>(path: string, body?: unknown) => tryRequest<T>(path, json("PUT", body)),
  tryPatch: <T>(path: string, body?: unknown) => tryRequest<T>(path, json("PATCH", body)),
  tryDelete: <T>(path: string, body?: unknown) => tryRequest<T>(path, json("DELETE", body)),
  // Auth goes through the cookie-based, same-origin flow in ./api/auth. These wrappers
  // stay for the legacy PWA shell; they return the in-memory access token it expects.
  login: async (email: string, password: string, totp_code?: string) => {
    const r = await authApi.login({ email, password, totp_code: totp_code || null });
    if (!r.ok) throw new Error(`API /auth/login failed: ${r.status}`);
    return { access_token: authStore.access ?? "" };
  },
  signup: async (payload: {
    email: string;
    password: string;
    display_name?: string;
    household_name?: string;
    base_currency?: string;
  }) => {
    const r = await authApi.signup(payload);
    if (!r.ok) throw new Error(`API /auth/signup failed: ${r.status}`);
    return { access_token: authStore.access ?? "" };
  },
  refresh: () => authApi.refresh(),
  logout: () => authApi.logout(),
  uploadDocument: (file: File | Blob, meta: { type?: string; source_channel?: string; source_label?: string }) => {
    const form = new FormData();
    form.append("file", file);
    if (meta.type) form.append("type", meta.type);
    form.append("source_channel", meta.source_channel ?? "upload");
    if (meta.source_label) form.append("source_label", meta.source_label);
    return request<Record<string, unknown>>("/documents", { method: "POST", body: form });
  },
  tryUploadDocument: (file: File | Blob, meta: { type?: string; source_channel?: string; source_label?: string }) => {
    const form = new FormData();
    form.append("file", file);
    if (meta.type) form.append("type", meta.type);
    form.append("source_channel", meta.source_channel ?? "upload");
    if (meta.source_label) form.append("source_label", meta.source_label);
    return tryRequest<Record<string, unknown>>("/documents", { method: "POST", body: form });
  },
};
