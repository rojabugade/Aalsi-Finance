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

// Fresh first-run: clear BOTH the saved board and the onboarded flag every load.
async function authenticateFresh(page: Page, tokens: { access_token: string; refresh_token: string }) {
  await page.addInitScript(
    (t) => {
      window.localStorage.setItem("cbf.accessToken", t.access);
      window.localStorage.setItem("cbf.refreshToken", t.refresh);
      // Clear once per test context so a reload keeps whatever the app persisted.
      if (!window.sessionStorage.getItem("cf.e2eOnboardSeeded")) {
        window.localStorage.removeItem("cf-board:dashboard");
        window.localStorage.removeItem("cf-onboarded:dashboard");
        window.sessionStorage.setItem("cf.e2eOnboardSeeded", "1");
      }
    },
    { access: tokens.access_token, refresh: tokens.refresh_token },
  );
}

test.describe("dashboard onboarding", () => {
  test("first visit shows goal modal; picking a goal generates the board and persists", async ({ page, request }) => {
    await authenticateFresh(page, await signup(request));
    await page.goto("/dashboard");

    // Modal visible on first run.
    await expect(page.getByText("What's your focus?")).toBeVisible();

    // Pick "Pay off debt" → debt template applies, modal closes, blurb shows.
    await page.getByRole("button", { name: /Pay off debt/i }).click();
    await expect(page.getByText("What's your focus?")).toHaveCount(0);
    await expect(page.getByText(/led with your debt/i)).toBeVisible();

    // Re-loading the SAME page (flag now set) does not re-open the modal.
    await page.reload();
    await expect(page.getByText("What's your focus?")).toHaveCount(0);
  });

  test("skip keeps the default board and never re-opens", async ({ page, request }) => {
    await authenticateFresh(page, await signup(request));
    await page.goto("/dashboard");
    await expect(page.getByText("What's your focus?")).toBeVisible();
    await page.getByRole("button", { name: /Skip/i }).click();
    await expect(page.getByText("What's your focus?")).toHaveCount(0);
  });
});
