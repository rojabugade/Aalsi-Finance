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

test("income surface renders sources + equity", async ({ page }) => {
  await login(page);
  await page.goto("/income");
  await expect(page.getByRole("button", { name: /add source/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^equity$/i })).toBeVisible();
});

test("guidance surface switches between ask, wizard, cross-border", async ({ page }) => {
  await login(page);
  await page.goto("/guidance");
  await expect(page.getByRole("tab", { name: /^ask$/i })).toBeVisible();
  await page.goto("/guidance?tab=plan");
  await expect(page.getByRole("button", { name: /build plan/i })).toBeVisible();
  await page.getByRole("button", { name: /^cross-border$/i }).click();
  await expect(page.getByRole("button", { name: /log transfer/i })).toBeVisible();
  await expect(page.getByText("Remittance limits")).toBeVisible();
});
