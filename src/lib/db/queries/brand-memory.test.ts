import { describe, expect, it, vi } from "vitest";
import { getBrandMemory, upsertBrandMemory } from "./index";

vi.mock("@/lib/db/client", () => ({ db: {} }));

describe("brand memory queries", () => {
  it("exports upsert + read", () => {
    expect(typeof getBrandMemory).toBe("function");
    expect(typeof upsertBrandMemory).toBe("function");
  });
});
