import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://localhost:8000";
const EMAIL = process.env.E2E_EMAIL ?? "dev@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "hunter2pass";

async function signup(request: APIRequestContext) {
  const res = await request.post(`${API}/auth/signup`, {
    data: { email: EMAIL, password: PASSWORD, display_name: "E2E", workspace_name: "E2E Workspace" },
  });
  if (res.ok()) return (await res.json()) as { access_token: string; refresh_token: string };

  const login = await request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASSWORD, totp_code: null },
  });
  expect(login.ok(), `login failed: ${login.status()}`).toBeTruthy();
  return (await login.json()) as { access_token: string; refresh_token: string };
}

async function authenticate(page: Page, tokens: { access_token: string; refresh_token: string }) {
  await page.addInitScript((t) => {
    window.localStorage.setItem("cbf.accessToken", t.access);
    window.localStorage.setItem("cbf.refreshToken", t.refresh);
  }, { access: tokens.access_token, refresh: tokens.refresh_token });
}

test("insights surface renders with section tabs", async ({ page, request }) => {
  await authenticate(page, await signup(request));
  await page.goto("/analytics");
  await expect(page.getByRole("tab", { name: /^overview$/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^budgets$/i })).toBeVisible();
});

test("budgets surface renders with a create action", async ({ page, request }) => {
  await authenticate(page, await signup(request));
  await page.goto("/budgets");
  await expect(page.getByRole("button", { name: /new budget/i })).toBeVisible();
});

test("debt surface renders with payoff strategy", async ({ page, request }) => {
  await authenticate(page, await signup(request));
  await page.goto("/debt");
  await expect(page.getByRole("button", { name: /add loan/i })).toBeVisible();
});
