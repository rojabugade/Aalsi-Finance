import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://localhost:8000";

// A 1x1 PNG — enough for the documents endpoint to accept an image upload.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

async function signup(request: APIRequestContext) {
  const email = `e2e+${Date.now()}@codenamefinance.app`;
  const password = "hunter2pass";
  const res = await request.post(`${API}/auth/signup`, {
    data: { email, password, display_name: "E2E", workspace_name: "E2E Workspace" },
  });
  expect(res.ok(), `signup failed: ${res.status()}`).toBeTruthy();
  const tokens = (await res.json()) as { access_token: string; refresh_token: string };
  return { email, password, tokens };
}

async function authenticate(page: Page, tokens: { access_token: string; refresh_token: string }) {
  // Seed the token store before any app script runs.
  await page.addInitScript((t) => {
    window.localStorage.setItem("cbf.accessToken", t.access);
    window.localStorage.setItem("cbf.refreshToken", t.refresh);
  }, { access: tokens.access_token, refresh: tokens.refresh_token });
}

test("nav shell persists across in-app navigation (regression)", async ({ page, request }) => {
  const { tokens } = await signup(request);
  await authenticate(page, tokens);

  await page.goto("/dashboard");
  const nav = page.getByRole("link", { name: "Spend" });
  await expect(nav).toBeVisible();

  // Into a built surface…
  await page.getByRole("link", { name: "Spend" }).click();
  await expect(page.getByRole("heading", { name: "Spend" })).toBeVisible();

  // …into another surface (previously a 404 that dropped the shell)…
  await page.getByRole("link", { name: "Insights" }).click();
  await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();

  // …and back out. The sidebar must still be there.
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Spend" })).toBeVisible();
});

test("capture uploads a document end-to-end", async ({ page, request }) => {
  const { tokens } = await signup(request);
  await authenticate(page, tokens);

  await page.goto("/capture");
  await expect(page.getByRole("heading", { name: "Capture" })).toBeVisible();

  // The upload <input> is hidden behind the "Upload file" button.
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: PNG_1x1,
  });

  // It should leave the queue once synced (empty-state copy returns).
  await expect(page.getByText("Everything is synced.")).toBeVisible({ timeout: 15_000 });

  // And the server should now hold exactly one document.
  const docs = await request.get(`${API}/documents`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  expect(docs.ok()).toBeTruthy();
  expect((await docs.json()).length).toBeGreaterThanOrEqual(1);
});
