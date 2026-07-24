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
  await page.addInitScript(
    (t) => {
      window.localStorage.setItem("cbf.accessToken", t.access);
      window.localStorage.setItem("cbf.refreshToken", t.refresh);
    },
    { access: tokens.access_token, refresh: tokens.refresh_token },
  );
}

test.describe("desktop top bar", () => {
  test("dashboard shows top-bar search and +Add", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await expect(page.getByRole("search")).toBeVisible();
    await expect(page.getByRole("button", { name: /^add$/i })).toBeVisible();
  });

  test("account menu opens settings", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /account menu/i }).click();
    await page.getByRole("menuitem", { name: /^settings$/i }).click();
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("desktop rail signs out", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /account menu/i }).click();
    await page.getByRole("menuitem", { name: /sign out/i }).click();

    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => window.localStorage.getItem("cbf.accessToken"))).toBeNull();
    expect(await page.evaluate(() => window.localStorage.getItem("cbf.refreshToken"))).toBeNull();
  });

  test("+Add menu opens capture actions", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /^add$/i }).click();
    await expect(page.getByRole("menuitem", { name: /scan receipt/i })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /import csv/i })).toBeVisible();
  });

  test("search navigates to the spend ledger", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await page.getByRole("searchbox", { name: /search/i }).fill("amazon");
    await page.getByRole("searchbox", { name: /search/i }).press("Enter");
    await expect(page).toHaveURL(/\/transactions\?view=all&q=amazon/);
  });

  test("rail no longer has a standalone Capture link", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    const rail = page.getByRole("navigation", { name: /primary/i });
    await expect(rail.getByRole("link", { name: /^capture$/i })).toHaveCount(0);
  });
});
