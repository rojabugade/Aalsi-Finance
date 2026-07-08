import { describe, it, expectTypeOf } from "vitest";
import type { ReviewQueue } from "@/lib/api/review";

describe("review queue type", () => {
  it("has groups and items", () => {
    expectTypeOf<ReviewQueue>().toHaveProperty("groups");
    expectTypeOf<ReviewQueue>().toHaveProperty("items");
  });
});
