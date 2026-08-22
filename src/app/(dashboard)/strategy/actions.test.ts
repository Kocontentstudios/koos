import { beforeEach, describe, expect, it, vi } from "vitest";

const requireBrand = vi.fn();
const getStrategyById = vi.fn();
const updateStrategy = vi.fn();

vi.mock("@/lib/auth/require-brand", () => ({
  requireBrand: () => requireBrand(),
}));
vi.mock("@/lib/db/queries", () => ({
  getStrategyById: (id: string) => getStrategyById(id),
  updateStrategy: (id: string, data: unknown) => updateStrategy(id, data),
}));

import { markStrategyActive } from "./actions";

describe("markStrategyActive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireBrand.mockResolvedValue({ brand: { id: "brand-1" } });
    updateStrategy.mockResolvedValue(undefined);
  });

  /* Regression: this action shipped with NO authorization at all — no session
     check, no ownership check. Server actions are reachable POST endpoints, so
     any caller could flip any strategy id to active. */
  it("authorizes the caller before writing anything", async () => {
    getStrategyById.mockResolvedValue({ id: "s1", brandId: "brand-1" });
    const res = await markStrategyActive("s1");
    expect(res).toEqual({ ok: true });
    expect(requireBrand).toHaveBeenCalled();
    expect(
      requireBrand.mock.invocationCallOrder[0],
      "authorization must run before the write",
    ).toBeLessThan(updateStrategy.mock.invocationCallOrder[0]);
  });

  it("refuses a strategy belonging to another brand", async () => {
    getStrategyById.mockResolvedValue({ id: "s1", brandId: "someone-else" });
    const res = await markStrategyActive("s1");
    expect(res).toEqual({ ok: false, error: "Strategy not found." });
    expect(updateStrategy).not.toHaveBeenCalled();
  });

  it("refuses a strategy that does not exist, without leaking that fact", async () => {
    getStrategyById.mockResolvedValue(null);
    const res = await markStrategyActive("nope");
    expect(res).toEqual({ ok: false, error: "Strategy not found." });
    expect(updateStrategy).not.toHaveBeenCalled();
  });
});
