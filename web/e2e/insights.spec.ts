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

test.describe("insights overview", () => {
  test("shows net worth card and cash-flow sankey", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/analytics");
    await expect(page.getByTestId("net-worth-card")).toBeVisible();
    await expect(page.getByTestId("cash-flow-sankey")).toBeVisible();
  });

  test("budgets section has a plain-language intro", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/budgets");
    await expect(page.getByTestId("section-intro")).toBeVisible();
  });
});
