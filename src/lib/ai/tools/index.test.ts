import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/queries", () => ({ checkBrandAccess: vi.fn() }));

import { buildBrandTools, providerSupportsTools } from "./index";

describe("tool registry", () => {
  it("includes read and propose tools", () => {
    const tools = buildBrandTools({ userId: "u", brandId: "b" });
    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining([
        "get_brand_profile",
        "propose_brand_field_updates",
      ]),
    );
  });
  it("knows which providers support tools", () => {
    expect(providerSupportsTools("bedrock")).toBe(true);
    expect(providerSupportsTools("zai")).toBe(false);
  });
});
