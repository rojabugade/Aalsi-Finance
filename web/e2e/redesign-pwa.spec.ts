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

test.describe("pwa", () => {
  test("manifest is served and branded", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.name).toBe("CodeName-Finance");
    expect(json.theme_color).toBe("#f1f1fa");
  });

  test("offline banner appears when context goes offline", async ({ browser, request }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.getByRole("status")).toContainText(/offline/i);
    await context.setOffline(false);
    await context.close();
  });

  test("install entry surfaces a path on iOS UA", async ({ browser, request }) => {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const page = await context.newPage();
    await authenticate(page, await signup(request));
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: /install app/i })).toBeVisible();
    await page.getByRole("button", { name: /install app/i }).click();
    await expect(page.getByText(/add to home screen/i)).toBeVisible();
    await context.close();
  });
});
