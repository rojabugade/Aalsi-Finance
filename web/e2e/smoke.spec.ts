import { test, expect } from "@playwright/test";

test("logged-out root serves the landing page, not a redirect", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/every receipt/i);
  await expect(page.getByRole("link", { name: /^sign in$/i })).toBeVisible();
});

test("the landing CTA opens signup with the signup tab already active", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /create account/i }).first().click();

  await expect(page).toHaveURL(/\/login\?mode=signup$/);
  await expect(page.getByRole("heading", { name: /create your account/i })).toBeVisible();
  await expect(page.getByLabel(/confirm password/i)).toBeVisible();
});

test("login form has email, password, and MFA fields", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
  await expect(page.getByLabel(/authenticator code/i)).toBeVisible();
});

test("signup section has account and currency fields", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /create account/i }).first().click();

  await expect(page.getByRole("heading", { name: /create your account/i })).toBeVisible();
  await expect(page.getByLabel(/display name/i)).toBeVisible();
  await expect(page.getByLabel(/currency/i)).toHaveValue("USD");
  await expect(page.getByLabel(/confirm password/i)).toBeVisible();
  await expect(page.getByLabel(/authenticator code/i)).not.toBeVisible();
});
