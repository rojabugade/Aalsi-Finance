import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "@shared/api-schema";
import { authApi, authStore } from "./auth";

const BROWSER_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const SERVER_URL = process.env.API_INTERNAL_URL ?? BROWSER_URL;
export const apiBaseUrl = typeof window === "undefined" ? SERVER_URL : BROWSER_URL;

// Single-flight refresh: concurrent 401s share one /auth/refresh round-trip.
let refreshing: Promise<boolean> | null = null;
function refreshOnce(): Promise<boolean> {
  refreshing ??= authApi.refresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    const token = authStore.access;
    if (token) request.headers.set("Authorization", `Bearer ${token}`);
    return request;
  },
  async onResponse({ request, response }) {
    if (response.status !== 401 || request.url.includes("/auth/")) return response;
    const ok = await refreshOnce();
    if (!ok) return response;
    const retry = new Request(request.url, request);
    retry.headers.set("Authorization", `Bearer ${authStore.access}`);
    return fetch(retry);
  },
};

export const api = createClient<paths>({ baseUrl: apiBaseUrl, credentials: "include" });
api.use(authMiddleware);
