import { describe, expect, it, vi, beforeEach } from "vitest";

const post = vi.fn(async (..._a: unknown[]) => ({ data: { plaid_item_id: "i1", accounts_created: 2, status: "active" }, error: undefined }));
vi.mock("./client", () => ({ api: { POST: (...a: unknown[]) => post(...a) } }));
vi.mock("@tanstack/react-query", () => ({ useMutation: (opts: unknown) => opts }));

import { useExchangePlaidToken, useSyncPlaid } from "./connections";

describe("plaid hooks", () => {
  beforeEach(() => post.mockClear());
  it("exchange posts the public token", async () => {
    const { mutationFn } = useExchangePlaidToken() as unknown as { mutationFn: (b: unknown) => Promise<unknown> };
    await mutationFn({ public_token: "pt", institution_name: "Chase", accounts: [] });
    expect(post).toHaveBeenCalledWith("/plaid/exchange", { body: { public_token: "pt", institution_name: "Chase", accounts: [] } });
  });
  it("sync posts an optional item id", async () => {
    const { mutationFn } = useSyncPlaid() as unknown as { mutationFn: (b?: unknown) => Promise<unknown> };
    await mutationFn({ plaid_item_id: "i1" });
    expect(post).toHaveBeenCalledWith("/plaid/sync", { body: { plaid_item_id: "i1" } });
  });
});
