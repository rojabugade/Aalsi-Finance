import { test, expect } from "@playwright/test";

test("unauthenticated root redirects to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
});

test("login form has email, password, and MFA fields", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
  await expect(page.getByLabel(/authenticator code/i)).toBeVisible();
});

test("signup section has account and household fields", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /create account/i }).first().click();

  await expect(page.getByRole("heading", { name: /create your account/i })).toBeVisible();
  await expect(page.getByLabel(/display name/i)).toBeVisible();
  await expect(page.getByLabel(/household/i)).toBeVisible();
  await expect(page.getByLabel(/currency/i)).toHaveValue("USD");
  await expect(page.getByLabel(/confirm password/i)).toBeVisible();
  await expect(page.getByLabel(/authenticator code/i)).not.toBeVisible();
});
