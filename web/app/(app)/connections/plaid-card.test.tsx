import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const open = vi.fn();
let capturedOnSuccess: ((t: string, m: unknown) => void) | undefined;
vi.mock("react-plaid-link", () => ({
  usePlaidLink: (cfg: { token: string | null; onSuccess: (t: string, m: unknown) => void }) => {
    capturedOnSuccess = cfg.onSuccess;
    return { open, ready: Boolean(cfg.token) };
  },
}));
const linkMutate = vi.fn(async () => ({ link_token: "lt" }));
const exchangeMutate = vi.fn(async () => ({ plaid_item_id: "i1", accounts_created: 1, status: "active" }));
const syncMutate = vi.fn(async () => ({ documents_created: 1, transactions_created: 3 }));
vi.mock("@/lib/api/connections", () => ({
  usePlaidLinkToken: () => ({ mutateAsync: linkMutate, isPending: false }),
  useExchangePlaidToken: () => ({ mutateAsync: exchangeMutate, isPending: false }),
  useSyncPlaid: () => ({ mutateAsync: syncMutate, isPending: false }),
  usePlaidItems: () => ({ data: [] }),
  useDisconnectPlaidItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { PlaidCard } from "./plaid-card";

afterEach(() => { open.mockClear(); linkMutate.mockClear(); exchangeMutate.mockClear(); syncMutate.mockClear(); });

describe("PlaidCard", () => {
  it("requests a token, opens Link, exchanges and syncs on success", async () => {
    render(<PlaidCard />);
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /connect bank/i }));
    await waitFor(() => expect(linkMutate).toHaveBeenCalled());
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    capturedOnSuccess?.("public-tok", { institution: { name: "Chase" }, accounts: [] });
    await waitFor(() => expect(exchangeMutate).toHaveBeenCalled());
    await waitFor(() => expect(syncMutate).toHaveBeenCalled());
  });
});
