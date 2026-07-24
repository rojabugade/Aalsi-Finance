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
      if (!window.sessionStorage.getItem("cf.e2eDashboardSeeded")) {
        window.localStorage.removeItem("cf-board:dashboard");
        window.localStorage.setItem("cf-onboarded:dashboard", "1");
        window.sessionStorage.setItem("cf.e2eDashboardSeeded", "1");
      }
    },
    { access: tokens.access_token, refresh: tokens.refresh_token },
  );
}

test.describe("widget rendering standard", () => {
  test("breakdown donut renders at standard preset on default board (§1 bug fix)", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");

    const breakdown = page.locator('[data-widget="breakdown"]');
    await expect(breakdown).toBeVisible();

    // At default preset=standard, chart=donut, 5×2: resolveTier → chart/donut.
    // Before the fix this rendered a list. Now it must render the donut.
    const donut = breakdown.locator('[data-block-kind="donut"]');
    await expect(donut).toBeVisible({ timeout: 10_000 });
  });

  test("breakdown falls back to list when preset=compact", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    // authenticate's init script clears cf-board:dashboard; this one runs after and writes a compact board
    await page.addInitScript(() => {
      window.localStorage.setItem("cf-board:dashboard", JSON.stringify({
        version: 4,
        prefs: { density: "standard", showCurrency: true, range: "3m" },
        items: [{ id: "breakdown-compact-e2e", type: "breakdown", x: 0, y: 0, w: 5, h: 2, config: { preset: "compact", dimension: "merchant" } }],
      }));
    });
    await page.goto("/dashboard");
    const breakdown = page.locator('[data-widget="breakdown"]');
    await expect(breakdown).toBeVisible();
    await expect(breakdown.locator('[data-block-kind="donut"]')).toHaveCount(0);
    await expect(breakdown.locator('[data-block-kind="stat"]')).toBeVisible();
  });
});
