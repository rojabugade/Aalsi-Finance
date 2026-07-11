import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn(async (..._args: unknown[]) => ({ data: { messages: [] }, error: undefined }));
const post = vi.fn(async (..._args: unknown[]) => ({ data: { id: "plan-1" }, error: undefined }));
const patch = vi.fn(async (..._args: unknown[]) => ({ data: { id: "plan-1" }, error: undefined }));
const invalidate = vi.fn();

vi.mock("./client", () => ({
  api: {
    GET: (...args: unknown[]) => get(...args),
    POST: (...args: unknown[]) => post(...args),
    PATCH: (...args: unknown[]) => patch(...args),
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => options,
  useMutation: (options: unknown) => options,
  useQueryClient: () => ({ invalidateQueries: invalidate }),
}));

import {
  useCreatePlanItem,
  useCreateTransfer,
  useGuidanceAsk,
  useGuidanceThread,
  usePlanItems,
  useUpdatePlanItem,
} from "./guidance";

describe("guidance API hooks", () => {
  beforeEach(() => {
    get.mockClear();
    post.mockClear();
    patch.mockClear();
    invalidate.mockClear();
  });

  it("posts a Guidance ask body directly", async () => {
    const hook = useGuidanceAsk() as unknown as {
      mutationFn: (body: unknown) => Promise<unknown>;
    };
    const body = { question: "What applies?", domain: "general", thread_id: "overview" };

    await hook.mutationFn(body);

    expect(post).toHaveBeenCalledWith("/guidance/ask", { body });
  });

  it("loads a stable Guidance thread", async () => {
    const hook = useGuidanceThread("overview") as unknown as {
      queryKey: unknown[];
      queryFn: () => Promise<unknown>;
      enabled: boolean;
    };

    expect(hook.queryKey).toEqual(["guidance", "thread", "overview"]);
    expect(hook.enabled).toBe(true);
    await hook.queryFn();
    expect(get).toHaveBeenCalledWith("/guidance/thread/{key}/messages", {
      params: { path: { key: "overview" } },
    });
  });

  it("lists plan items with status in the query key and request", async () => {
    const hook = usePlanItems("open") as unknown as {
      queryKey: unknown[];
      queryFn: () => Promise<unknown>;
    };

    expect(hook.queryKey).toEqual(["guidance", "plan-items", "open"]);
    await hook.queryFn();
    expect(get).toHaveBeenCalledWith("/guidance/plan-items", {
      params: { query: { status: "open" } },
    });
  });

  it("creates and updates plan items and invalidates all plan lists", async () => {
    const create = useCreatePlanItem() as unknown as {
      mutationFn: (body: unknown) => Promise<unknown>;
      onSuccess: () => void;
    };
    const update = useUpdatePlanItem() as unknown as {
      mutationFn: (variables: { id: string; body: unknown }) => Promise<unknown>;
      onSuccess: () => void;
    };
    const createBody = { title: "Review limits", domain: "cross_border" };
    const updateBody = { status: "completed" };

    await create.mutationFn(createBody);
    expect(post).toHaveBeenCalledWith("/guidance/plan-items", { body: createBody });
    create.onSuccess();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["guidance", "plan-items"] });

    await update.mutationFn({ id: "plan-1", body: updateBody });
    expect(patch).toHaveBeenCalledWith("/guidance/plan-items/{item_id}", {
      params: { path: { item_id: "plan-1" } },
      body: updateBody,
    });
    update.onSuccess();
    expect(invalidate).toHaveBeenLastCalledWith({ queryKey: ["guidance", "plan-items"] });
  });

  it("invalidates transfers and limits after creating a transfer", () => {
    const hook = useCreateTransfer() as unknown as { onSuccess: () => void };

    hook.onSuccess();

    expect(invalidate).toHaveBeenNthCalledWith(1, {
      queryKey: ["cross-border", "transfers"],
    });
    expect(invalidate).toHaveBeenNthCalledWith(2, {
      queryKey: ["cross-border", "limits"],
    });
  });
});
