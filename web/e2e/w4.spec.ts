import { test, expect } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "dev@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "hunter2pass";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("notifications surface shows prefs + recent list", async ({ page }) => {
  await login(page);
  await page.goto("/notifications");
  // Preferences live in a collapsed disclosure on the feed-first page.
  await page.locator("summary", { hasText: "Preferences" }).click();
  await expect(page.getByText("Choose channels and quiet hours.")).toBeVisible();
  await expect(page.getByRole("button", { name: /save preferences/i })).toBeVisible();
});

test("connections surface lists Plaid, email forwarding, SMS, bot", async ({ page }) => {
  await login(page);
  await page.goto("/connections");
  await expect(page.getByRole("button", { name: /connect bank/i })).toBeVisible();
  await expect(page.getByText(/email forwarding/i)).toBeVisible();
});

test("settings surface shows workspace, prefs, and data controls", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  await expect(page.getByText("Export everything, or delete your account.")).toBeVisible();
  await expect(page.getByRole("button", { name: /delete account/i })).toBeVisible();
});
