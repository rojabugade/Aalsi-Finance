import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://localhost:8000";
const EMAIL = process.env.E2E_EMAIL ?? "dev@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "hunter2pass";

async function signup(request: APIRequestContext) {
  const res = await request.post(`${API}/auth/signup`, {
    data: { email: EMAIL, password: PASSWORD, display_name: "E2E", household_name: "E2E House" },
  });
  if (res.ok()) return (await res.json()) as { access_token: string; refresh_token: string };
  const login = await request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASSWORD, totp_code: null },
  });
  expect(login.ok(), `login failed: ${login.status()}`).toBeTruthy();
  return (await login.json()) as { access_token: string; refresh_token: string };
}

async function authenticate(page: Page, tokens: { access_token: string; refresh_token: string }) {
  await page.addInitScript(
    (t) => {
      window.localStorage.setItem("cbf.accessToken", t.access);
      window.localStorage.setItem("cbf.refreshToken", t.refresh);
    },
    { access: tokens.access_token, refresh: tokens.refresh_token },
  );
}

const SURFACES = [
  "/dashboard",
  "/transactions",
  "/capture",
  "/review",
  "/analytics",
  "/budgets",
  "/debt",
  "/income",
  "/guidance",
  "/notifications",
  "/connections",
  "/settings",
];

test.describe("redesign surfaces render under the shell", () => {
  for (const path of SURFACES) {
    test(`${path} renders with bottom nav`, async ({ page, request }) => {
      await authenticate(page, await signup(request));
      await page.goto(path);
      await expect(page.getByRole("navigation", { name: /primary/i })).toBeVisible();
      await expect(page.locator("body")).toBeVisible();
    });
  }

  test("dashboard shows the hero net cash flow", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await expect(page.getByText(/net cash flow/i)).toBeVisible();
  });

  test("spend surface exposes the Merchants tab", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/transactions");
    await expect(page.getByRole("tab", { name: /^merchants$/i })).toBeVisible();
  });
});
