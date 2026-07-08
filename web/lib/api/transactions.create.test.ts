import { describe, expect, it, vi, beforeEach } from "vitest";

const post = vi.fn(async (..._a: unknown[]) => ({ data: { id: "t1", merchant: "Cafe" }, error: undefined }));
const invalidate = vi.fn();
vi.mock("./client", () => ({ api: { POST: (...a: unknown[]) => post(...a) } }));
vi.mock("@tanstack/react-query", () => ({
  useMutation: (opts: unknown) => opts,
  useQueryClient: () => ({ invalidateQueries: invalidate }),
}));

import { useCreateTransaction } from "./transactions";

describe("useCreateTransaction", () => {
  beforeEach(() => { post.mockClear(); invalidate.mockClear(); });

  it("posts to /transactions and invalidates the transactions key", async () => {
    const { mutationFn, onSuccess } = useCreateTransaction() as unknown as {
      mutationFn: (b: unknown) => Promise<unknown>;
      onSuccess: () => void;
    };
    const body = { merchant: "Cafe", amount: "4.50", currency: "USD", txn_date: "2026-06-22" };
    const result = await mutationFn(body);
    expect(post).toHaveBeenCalledWith("/transactions", { body });
    expect(result).toEqual({ id: "t1", merchant: "Cafe" });
    onSuccess();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["transactions"] });
  });
});
