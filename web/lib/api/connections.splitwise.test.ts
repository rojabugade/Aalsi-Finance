import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn(async (..._args: unknown[]) => ({
  data: { authorization_url: "https://splitwise.example/auth", state: "state" },
  error: undefined,
}));
const del = vi.fn(async (..._args: unknown[]) => ({ error: undefined }));

vi.mock("./client", () => ({
  api: {
    POST: (...args: unknown[]) => post(...args),
    DELETE: (...args: unknown[]) => del(...args),
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: unknown) => options,
}));

import {
  useDisconnectSplitwise,
  useSplitwiseOAuthStart,
  useSplitwiseSync,
} from "./connections";

describe("Splitwise hooks", () => {
  beforeEach(() => {
    post.mockClear();
    del.mockClear();
  });

  it("starts OAuth and syncs balances", async () => {
    const start = useSplitwiseOAuthStart() as unknown as { mutationFn: () => Promise<unknown> };
    const sync = useSplitwiseSync() as unknown as { mutationFn: () => Promise<unknown> };

    await start.mutationFn();
    await sync.mutationFn();

    expect(post).toHaveBeenNthCalledWith(1, "/splitwise/oauth/start", {});
    expect(post).toHaveBeenNthCalledWith(2, "/splitwise/sync", {});
  });

  it("disconnects the current connection", async () => {
    const disconnect = useDisconnectSplitwise() as unknown as { mutationFn: () => Promise<void> };
    await disconnect.mutationFn();
    expect(del).toHaveBeenCalledWith("/splitwise/connection", {});
  });
});
