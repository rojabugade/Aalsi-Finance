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
      if (!window.sessionStorage.getItem("cf.e2eDashboardSeeded")) {
        window.localStorage.removeItem("cf-board:dashboard");
        window.localStorage.setItem("cf-onboarded:dashboard", "1");
        window.sessionStorage.setItem("cf.e2eDashboardSeeded", "1");
      }
    },
    { access: tokens.access_token, refresh: tokens.refresh_token },
  );
}

test.describe("classic configurable dashboard", () => {
  test("enters edit mode and hides + re-adds a widget", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard/classic");
    await expect(page.getByTestId("dashboard-grid")).toBeVisible();
    await expect(page.locator('[data-widget="breakdown"]')).toBeVisible();
    await expect(page.getByText("Merchant Categorization")).toBeVisible();
    await expect(page.locator('[data-widget="itemIntel"]')).toHaveCount(0);
    await expect(page.locator('[data-widget="categories"]')).toHaveCount(0);

    const netWorth = page.locator('[data-widget="netWorth"]');
    await expect(netWorth).toBeVisible();

    await page.getByRole("button", { name: "Personalize" }).click();

    // hide Net Worth via its frame button (Layout tab keeps the canvas interactive)
    await netWorth.getByRole("button", { name: /hide widget/i }).click();
    await expect(page.locator('[data-widget="netWorth"]')).toHaveCount(0);

    // re-add from the Widgets-tab library
    await page.getByRole("tab", { name: "Widgets" }).click();
    await page.getByRole("button", { name: /add net worth/i }).click();
    await expect(page.locator('[data-widget="netWorth"]')).toHaveCount(1);
  });

  test("Layout tab shows the snap lattice; closing hides it", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard/classic");

    await expect(page.getByTestId("dashboard-grid-lattice")).toHaveCount(0);
    await page.getByRole("button", { name: "Personalize" }).click();
    await expect(page.getByTestId("dashboard-grid-lattice")).toBeVisible();

    // close via the pane's own Close button (always on top of the floating pane)
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("dashboard-grid-lattice")).toHaveCount(0);
  });

  test("selects a widget and persists configurable controls", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard/classic");
    await page.getByRole("button", { name: "Personalize" }).click();

    // select on the Layout tab (canvas interactive), then configure in the Widgets tab
    await page.locator('[data-widget="breakdown"]').click();
    await page.getByRole("tab", { name: "Widgets" }).click();
    await expect(page.getByTestId("widget-config-controls")).toContainText("Editing: Merchant Categorization");

    await page.getByRole("button", { name: "3 mo" }).click();
    await page.getByRole("button", { name: "Category" }).click();
    await page.getByRole("switch", { name: /hide amounts/i }).click();

    const saved = await page.evaluate(() => {
      const board = JSON.parse(window.localStorage.getItem("cf-board:dashboard") ?? "{}");
      return board.items?.find((item: { type: string }) => item.type === "breakdown")?.config;
    });
    expect(saved).toMatchObject({ range: "3m", dimension: "category", show: { amounts: false } });

    await page.reload();
    const reloaded = await page.evaluate(() => {
      const board = JSON.parse(window.localStorage.getItem("cf-board:dashboard") ?? "{}");
      return board.items?.find((item: { type: string }) => item.type === "breakdown")?.config;
    });
    expect(reloaded).toMatchObject({ range: "3m", dimension: "category", show: { amounts: false } });
  });

  test("layout persists across reload", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard/classic");
    await page.getByRole("button", { name: "Personalize" }).click();
    // netWorth remains interactive while the inline Personalize panel is open.
    await page.locator('[data-widget="netWorth"]').getByRole("button", { name: /hide widget/i }).click();
    await page.reload();
    await expect(page.locator('[data-widget="netWorth"]')).toHaveCount(0);
  });

  test("global date range drives follow-global widgets but not custom-range ones", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard/classic");

    // Change the board-wide range from the global controls bar.
    await page.getByTestId("date-range").click();
    await page.getByRole("menuitem", { name: "1 year" }).click();

    const state = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("cf-board:dashboard") ?? "{}"),
    );
    expect(state.prefs.range).toBe("1y");
    // breakdown carries no explicit range -> follows the global range
    const breakdown = state.items.find((i: { type: string }) => i.type === "breakdown");
    expect(breakdown.config?.range).toBeUndefined();
    // net worth has a seeded override -> unaffected by the global change
    const netWorth = state.items.find((i: { type: string }) => i.type === "netWorth");
    expect(netWorth.config?.range).toBe("6m");
  });

  test("global controls bar renders real + stub controls", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard/classic");

    await expect(page.getByTestId("dashboard-controls")).toBeVisible();
    await expect(page.getByRole("link", { name: "New" }).first()).toBeVisible();
    await expect(page.getByTestId("date-range")).toBeVisible();
    await expect(page.getByTestId("ask-ai-input")).toBeVisible();
    // Analyst toggle is a present-but-inert stub until slice G.
    await expect(page.getByTestId("analyst-toggle")).toBeDisabled();

    // Focusing the Ask-AI bar reveals inert quick actions (no execution yet).
    await page.getByTestId("ask-ai-input").focus();
    await expect(page.getByTestId("ask-ai-quick-actions")).toBeVisible();
  });

  test("opens migrated dashboard and returns to the configurable dashboard", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard/classic");
    await page.getByRole("link", { name: "New" }).first().click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId("new-dashboard")).toBeVisible();
    await page.getByRole("link", { name: "Classic" }).first().click();
    await expect(page).toHaveURL(/\/dashboard\/classic/);
    await expect(page.getByTestId("dashboard-grid")).toBeVisible();
  });

  test("opens Focus View from the actions menu and closes on Escape", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard/classic");
    const netWorth = page.locator('[data-widget="netWorth"]');
    await expect(netWorth).toBeVisible();
    await netWorth.getByRole("button", { name: /widget actions/i }).click();
    await page.getByRole("menuitem", { name: /expand/i }).click();
    await expect(page.getByTestId("focus-overview")).toBeVisible();
    await expect(page.getByText(/AI explanation/i)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("focus-overview")).toHaveCount(0);
  });

  test("duplicates a widget via the actions menu", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard/classic");
    const netWorth = page.locator('[data-widget="netWorth"]');
    await expect(netWorth.first()).toBeVisible();
    const before = await netWorth.count();
    await netWorth.first().getByRole("button", { name: /widget actions/i }).click();
    await page.getByRole("menuitem", { name: /duplicate/i }).click();
    await expect(netWorth).toHaveCount(before + 1);
  });

  test("changing a widget preset to Compact collapses it to the primary metric", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard/classic");
    await page.getByRole("button", { name: "Personalize" }).click();
    const netWorth = page.locator('[data-widget="netWorth"]');
    await netWorth.click();
    await page.getByRole("tab", { name: "Widgets" }).click();
    await expect(page.getByTestId("widget-config-controls")).toBeVisible();

    const controls = page.getByTestId("widget-config-controls");
    const chart = netWorth.locator("svg.recharts-surface");
    await controls.getByRole("button", { name: "Detailed", exact: true }).click();
    await expect(chart).toBeVisible();
    await controls.getByRole("button", { name: "Compact", exact: true }).click();
    await expect(chart).toHaveCount(0);
  });
});
