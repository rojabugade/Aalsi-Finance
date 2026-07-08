import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://localhost:8000";
const EMAIL = process.env.E2E_EMAIL ?? "dev@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "hunter2pass";

async function signup(request: APIRequestContext) {
  const response = await request.post(`${API}/auth/signup`, {
    data: { email: EMAIL, password: PASSWORD, display_name: "E2E", household_name: "E2E House" },
  });
  if (response.ok()) return response.json() as Promise<{ access_token: string; refresh_token: string }>;
  const login = await request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASSWORD, totp_code: null },
  });
  expect(login.ok()).toBeTruthy();
  return login.json() as Promise<{ access_token: string; refresh_token: string }>;
}

async function authenticate(page: Page, tokens: { access_token: string; refresh_token: string }) {
  await page.addInitScript(({ access, refresh }) => {
    window.localStorage.setItem("cbf.accessToken", access);
    window.localStorage.setItem("cbf.refreshToken", refresh);
    window.localStorage.setItem("cf-onboarded:dashboard", "1");
  }, { access: tokens.access_token, refresh: tokens.refresh_token });
}

test("blob opens the analyst pane and switches modes", async ({ page, request }) => {
  await authenticate(page, await signup(request));
  await page.goto("/dashboard");
  const blob = page.getByRole("button", { name: /ai analyst/i });
  await expect(blob).toBeVisible();
  await blob.click();
  const pane = page.getByRole("dialog", { name: /ai analyst/i });
  await expect(pane).toBeVisible();
  await pane.getByRole("tab", { name: "Explain" }).click();
  await expect(pane.getByPlaceholder(/ask the analyst/i)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pane).toBeHidden();
});
