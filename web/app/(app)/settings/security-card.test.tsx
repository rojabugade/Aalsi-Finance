import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const me = vi.fn(async () => ({
  id: "u1",
  email: "you@example.com",
  display_name: null,
  email_verified: false,
  mfa_enabled: false,
}));
const mfaStatus = vi.fn(async () => ({ mfa_enabled: false, unused_recovery_codes: 0 }));
const mfaEnroll = vi.fn(async () => ({ secret: "SECRET123", otpauth_uri: "otpauth://x" }));
const mfaVerify = vi.fn(async (_code: string) => [
  "AAAA-BBBB-CCCC-DDDD",
  "EEEE-FFFF-GGGG-HHHH",
]);
const requestEmailVerification = vi.fn(async () => ({ ok: true, status: 202 }));
const regenerateRecoveryCodes = vi.fn(async () => ["ZZZZ-YYYY-XXXX-WWWW"]);

vi.mock("@/lib/api/auth", () => ({
  authApi: {
    me: () => me(),
    mfaStatus: () => mfaStatus(),
    mfaEnroll: () => mfaEnroll(),
    mfaVerify: (code: string) => mfaVerify(code),
    requestEmailVerification: () => requestEmailVerification(),
    regenerateRecoveryCodes: () => regenerateRecoveryCodes(),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SecurityCard } from "./security-card";

afterEach(() => {
  vi.clearAllMocks();
  mfaStatus.mockResolvedValue({ mfa_enabled: false, unused_recovery_codes: 0 });
});

describe("SecurityCard", () => {
  it("prompts to confirm an unverified address and can resend", async () => {
    render(<SecurityCard />);
    await screen.findByText(/unconfirmed/i);
    fireEvent.click(screen.getByRole("button", { name: /send confirmation/i }));
    await waitFor(() => expect(requestEmailVerification).toHaveBeenCalled());
  });

  it("shows recovery codes once after enabling MFA", async () => {
    render(<SecurityCard />);
    fireEvent.click(await screen.findByRole("button", { name: /turn on/i }));

    // The secret is shown so it can be added to an authenticator app.
    await screen.findByText("SECRET123");
    fireEvent.change(screen.getByLabelText(/authenticator code/i), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(mfaVerify).toHaveBeenCalledWith("123456"));
    await screen.findByText("AAAA-BBBB-CCCC-DDDD");
    expect(screen.getByText("EEEE-FFFF-GGGG-HHHH")).toBeInTheDocument();

    // Dismissing hides them — the server will not return them again.
    fireEvent.click(screen.getByRole("button", { name: /saved them/i }));
    await waitFor(() =>
      expect(screen.queryByText("AAAA-BBBB-CCCC-DDDD")).not.toBeInTheDocument(),
    );
  });

  it("reports remaining recovery codes when MFA is already on", async () => {
    mfaStatus.mockResolvedValue({ mfa_enabled: true, unused_recovery_codes: 7 });
    render(<SecurityCard />);
    await screen.findByText(/7 recovery codes left/i);
  });
});
