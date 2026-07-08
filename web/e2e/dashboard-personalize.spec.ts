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
      if (!window.sessionStorage.getItem("cf.e2eDashboardSeeded")) {
        window.localStorage.removeItem("cf-board:dashboard");
        window.localStorage.setItem("cf-onboarded:dashboard", "1");
        window.sessionStorage.setItem("cf.e2eDashboardSeeded", "1");
      }
    },
    { access: tokens.access_token, refresh: tokens.refresh_token },
  );
}

test.describe("dashboard personalization", () => {
  test("Layout tab unlocks drag; other tabs lock it", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Personalize" }).click();
    // Layout tab is default → lattice (edit affordance) visible
    await page.getByRole("tab", { name: "Layout" }).click();
    await expect(page.getByTestId("dashboard-grid-lattice")).toBeVisible();
    // Switch to Appearance → lattice gone (widgets locked)
    await page.getByRole("tab", { name: "Appearance" }).click();
    await expect(page.getByTestId("dashboard-grid-lattice")).toHaveCount(0);
  });

  test("privacy level masks money on the canvas and Off restores it", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    // no masking by default
    await expect(page.getByText("•••••").first()).toHaveCount(0);

    await page.getByRole("button", { name: "Personalize" }).click();
    await page.getByRole("tab", { name: "Privacy" }).click();
    await page.getByRole("button", { name: "Privacy" }).click();
    await expect(page.getByText("•••••").first()).toBeVisible();

    await page.getByRole("button", { name: "Off" }).click();
    await expect(page.getByText("•••••")).toHaveCount(0);
  });
});
