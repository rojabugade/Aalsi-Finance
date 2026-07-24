import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://localhost:8000";
const EMAIL = process.env.E2E_EMAIL ?? "dev@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "hunter2pass";

async function signup(request: APIRequestContext) {
  const res = await request.post(`${API}/auth/signup`, {
    data: { email: EMAIL, password: PASSWORD, display_name: "E2E", workspace_name: "E2E Workspace" },
  });
  if (res.ok()) return (await res.json()) as { access_token: string; refresh_token: string };
  const login = await request.post(`${API}/auth/login`, { data: { email: EMAIL, password: PASSWORD, totp_code: null } });
  expect(login.ok(), `login failed: ${login.status()}`).toBeTruthy();
  return (await login.json()) as { access_token: string; refresh_token: string };
}
async function authenticate(page: Page, t: { access_token: string; refresh_token: string }) {
  await page.addInitScript(
    (x) => {
      window.localStorage.setItem("cbf.accessToken", x.a);
      window.localStorage.setItem("cbf.refreshToken", x.r);
    },
    { a: t.access_token, r: t.refresh_token },
  );
}

test.describe("activity feed", () => {
  test("shows the feed (or a caught-up empty state) and collapsible prefs", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/notifications");
    const feed = page.getByTestId("activity-feed");
    const empty = page.getByTestId("activity-empty");
    await expect(feed.or(empty)).toBeVisible();
    await expect(page.getByRole("button", { name: /preferences/i })).toBeVisible();
  });
});
