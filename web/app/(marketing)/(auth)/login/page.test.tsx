import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/lib/i18n/messages/en.json";
import LoginPage from "./page";

const searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

function renderLogin() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LoginPage />
    </NextIntlClientProvider>,
  );
}

/** The page asks /beta/status on mount to decide whether to show the code field. */
function stubBetaStatus(inviteRequired: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ invite_required: inviteRequired }), { status: 200 }),
    ),
  );
}

describe("login mode deep link", () => {
  beforeEach(() => {
    searchParams.delete("mode");
    stubBetaStatus(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens on the sign-in tab by default", () => {
    renderLogin();
    expect(
      screen.getByRole("heading", { level: 1, name: messages.auth.loginTitle }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(messages.auth.totp)).toBeInTheDocument();
  });

  it("opens on the signup tab when the landing CTA deep-links to it", () => {
    searchParams.set("mode", "signup");
    renderLogin();
    expect(
      screen.getByRole("heading", { level: 1, name: messages.auth.signupTitle }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(messages.auth.confirmPassword)).toBeInTheDocument();
    expect(screen.queryByLabelText(messages.auth.totp)).not.toBeInTheDocument();
  });

  it("ignores an unrecognised mode", () => {
    searchParams.set("mode", "nonsense");
    renderLogin();
    expect(
      screen.getByRole("heading", { level: 1, name: messages.auth.loginTitle }),
    ).toBeInTheDocument();
  });
});

describe("closed-beta invite field", () => {
  beforeEach(() => {
    searchParams.set("mode", "signup");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    searchParams.delete("mode");
  });

  it("asks for a code while the gate is up", async () => {
    stubBetaStatus(true);
    renderLogin();

    await waitFor(() => {
      expect(screen.getByLabelText(messages.auth.inviteCode)).toBeRequired();
    });
  });

  it("omits the field once the gate is down", async () => {
    stubBetaStatus(false);
    renderLogin();

    // Wait for the status call to settle, so this isn't just asserting on the
    // pre-fetch render — the field must stay absent after the answer arrives.
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByLabelText(messages.auth.inviteCode)).not.toBeInTheDocument();
  });

  it("never blocks sign-up on the status call failing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    renderLogin();

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    // No code box, and the form is still submittable: the server is the gate
    // that counts, and it answers with a message naming the missing code.
    expect(screen.queryByLabelText(messages.auth.inviteCode)).not.toBeInTheDocument();
    // Scoped by type: the mode tab carries the same label as the submit button.
    const submit = screen
      .getAllByRole("button", { name: messages.auth.signupSubmit })
      .find((button) => button.getAttribute("type") === "submit");
    expect(submit).toBeEnabled();
  });
});
