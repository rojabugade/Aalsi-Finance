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
    },
    { access: tokens.access_token, refresh: tokens.refresh_token },
  );
}

const COMBOS = [
  { theme: "emerald-light", bg: "#eef3f0" },
  { theme: "emerald-dark", bg: "#0b1512" },
  { theme: "indigo-light", bg: "#f1f1fa" },
  { theme: "indigo-dark", bg: "#0e0d16" },
  { theme: "ink-light", bg: "#f3f5f8" },
  { theme: "ink-dark", bg: "#0c0e12" },
];

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

test.describe("theme + a11y", () => {
  // The drawer + open-menu button only exist below the 1024px desktop breakpoint.
  test.use({ viewport: { width: 390, height: 844 } });

  test("every theme combo paints its --app-bg", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    for (const { theme, bg } of COMBOS) {
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      const body = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(body).toBe(hexToRgb(bg));
    }
  });

  test("theme persists with no flash across reload", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /open menu/i }).press("Enter");
    await expect(page.locator('.app-drawer[data-open="true"]')).toBeVisible();
    // Keyboard activation sidesteps the Next dev-indicator overlay over the footer.
    await page.getByRole("button", { name: /^ink$/i }).press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "ink-light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "ink-light");
  });

  test("drawer: focus enters, Escape closes", async ({ page, request }) => {
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    // Open via keyboard so the drawer moves focus inward (pointer-open intentionally
    // does not steal focus on touch devices).
    await page.getByRole("button", { name: /open menu/i }).press("Enter");
    const drawer = page.getByRole("complementary", { name: /more/i });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(".app-window")).toHaveAttribute("data-open", "false");
  });

  test("reduced motion: drawer toggles instantly", async ({ browser, request }) => {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await authenticate(page, await signup(request));
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /open menu/i }).click();
    await expect(page.locator(".app-window")).toHaveAttribute("data-open", "true");
    await context.close();
  });
});
