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

test.describe("spend overview", () => {
  test("shows insight strip + category list", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/transactions/classic");
    await expect(page.getByTestId("spend-insight-strip")).toBeVisible();
    await expect(page.getByTestId("spend-category-list")).toBeVisible();
  });

  test("clicking a category drills in", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/transactions/classic");
    const firstCat = page.getByTestId("spend-category-list").getByRole("link").first();
    await firstCat.click();
    await expect(page).toHaveURL(/\/transactions\/classic\?cat=/);
    await expect(page.getByTestId("spend-category-drill")).toBeVisible();
    await expect(page.getByText(/what changed/i)).toBeVisible();
  });

  test("default spend view lists merchant spend and opens merchant drill", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/transactions/classic");
    const merchantsCard = page.getByTestId("top-merchants-card");
    await expect(merchantsCard).toBeVisible();
    await expect(merchantsCard.getByTestId("spend-merchant-list")).toBeVisible();
    await merchantsCard.getByRole("button").first().click();
    await expect(page).toHaveURL(/\/transactions\/classic\?merchant=/);
    await expect(page.getByTestId("spend-merchant-drill")).toBeVisible();
  });

  test("flat ledger exposes a search box", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/transactions/classic?view=all");
    await expect(page.getByRole("search", { name: /filter transactions/i })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: /search transactions/i })).toBeVisible();
  });

  test("Spend exposes migrated tabs and the shell Classic/New switch", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/transactions");

    await expect(page.getByTestId("new-spend")).toBeVisible();
    await page.getByRole("tab", { name: "Merchants" }).click();
    await expect(page.getByText("Merchant intelligence")).toBeVisible();

    await page.getByRole("tab", { name: "Items" }).click();
    await expect(page.getByText("Item and product-type intelligence")).toBeVisible();

    await page.getByRole("tab", { name: "Recurring" }).click();
    await expect(page.getByText("Recurring and fixed expenses")).toBeVisible();

    await page.getByRole("link", { name: "Classic" }).first().click();
    await expect(page).toHaveURL(/\/transactions\/classic/);
    await expect(page.getByTestId("spend-insight-strip")).toBeVisible();
    await page.getByRole("link", { name: "New" }).first().click();
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(page.getByTestId("new-spend")).toBeVisible();
  });
});
