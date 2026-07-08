import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://localhost:8000";
const EMAIL = process.env.E2E_EMAIL ?? "dev@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "hunter2pass";

async function signup(request: APIRequestContext) {
  const res = await request.post(`${API}/auth/signup`, {
    data: { email: EMAIL, password: PASSWORD, display_name: "E2E", household_name: "E2E House" },
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

test.describe("redesign shell", () => {
  // Bottom nav, drawer, and open-menu only render below the 1024px desktop breakpoint.
  test.use({ viewport: { width: 390, height: 844 } });

  test("dashboard renders under the shell with bottom nav", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await expect(page.getByRole("navigation", { name: /primary/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^home$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^insights$/i })).toBeVisible();
  });

  test("theme switch persists across reload and updates theme-color", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");

    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", /-(light|dark)$/);

    await page.getByRole("button", { name: /open menu/i }).press("Enter");
    await expect(page.locator('.app-drawer[data-open="true"]')).toBeVisible();
    // Activate via keyboard: avoids the Next dev-indicator overlay intercepting
    // pointer events over the drawer footer at mobile width.
    await page.getByRole("button", { name: /^emerald$/i }).press("Enter");
    await page.getByRole("button", { name: /switch to dark mode/i }).press("Enter");

    await expect(html).toHaveAttribute("data-theme", "emerald-dark");
    const meta = page.locator('meta[name="theme-color"]');
    await expect(meta).toHaveAttribute("content", "#0b1512");

    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "emerald-dark");
  });

  test("all six theme combos apply", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    const combos = [
      "emerald-light",
      "emerald-dark",
      "indigo-light",
      "indigo-dark",
      "ink-light",
      "ink-dark",
    ];
    for (const theme of combos) {
      await page.evaluate((t) => {
        document.documentElement.setAttribute("data-theme", t);
      }, theme);
      const bg = await page.evaluate(() =>
        getComputedStyle(document.body).backgroundColor,
      );
      expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    }
  });

  test("drawer opens via avatar and closes via dimmed window", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");

    const windowEl = page.locator(".app-window");
    await expect(windowEl).toHaveAttribute("data-open", "false");

    await page.getByRole("button", { name: /open menu/i }).click();
    await expect(windowEl).toHaveAttribute("data-open", "true");
    await expect(page.getByRole("complementary", { name: /more/i })).toBeVisible();

    await page.getByRole("button", { name: /close menu/i }).click();
    await expect(windowEl).toHaveAttribute("data-open", "false");
  });

  test("reduced-motion: drawer still toggles state instantly", async ({ browser, request }) => {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /open menu/i }).click();
    await expect(page.locator(".app-window")).toHaveAttribute("data-open", "true");
    await context.close();
  });
});
