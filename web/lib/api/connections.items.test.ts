import { describe, expect, it, vi } from "vitest";
const get = vi.fn(async (..._a: unknown[]) => ({ data: [{ id: "i1", institution_name: "Chase", account_count: 2, status: "active" }], error: undefined }));
vi.mock("./client", () => ({ api: { GET: (...a: unknown[]) => get(...a) } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (opts: { queryFn: () => unknown }) => opts, useMutation: (o: unknown) => o, useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
import { usePlaidItems } from "./connections";

describe("usePlaidItems", () => {
  it("queries /plaid/items", async () => {
    const { queryKey, queryFn } = usePlaidItems() as unknown as { queryKey: unknown[]; queryFn: () => Promise<unknown> };
    expect(queryKey).toEqual(["plaid-items"]);
    await queryFn();
    expect(get).toHaveBeenCalledWith("/plaid/items", {});
  });
});
