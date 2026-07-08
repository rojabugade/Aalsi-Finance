import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { uploadDocument } from "@/lib/offline/sync";
import { authStore } from "@/lib/api/auth";

describe("uploadDocument group_hint", () => {
  beforeEach(() => {
    authStore.setAccess("tok"); // access token now lives in memory, not localStorage
  });

  afterEach(() => {
    authStore.clear();
    vi.unstubAllGlobals();
  });

  it("appends group_hint when provided", async () => {
    const seen: FormData[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(init.body as FormData);
      return new Response(JSON.stringify({ id: "d1" }), { status: 201 });
    }));

    await uploadDocument(new Blob(["x"]), { filename: "r.png", groupHint: "single" });

    expect(seen[0].get("group_hint")).toBe("single");
  });
});
