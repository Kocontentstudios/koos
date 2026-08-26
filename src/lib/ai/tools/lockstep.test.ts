import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/queries", () => ({ checkBrandAccess: vi.fn() }));

import { extractionSchema } from "@/lib/ai/onboarding/extraction";
import { brandFieldKeys } from "./proposals";
import { buildProposeTools } from "./propose";

/**
 * extraction.ts warns that these three shapes must stay in lockstep, but
 * nothing enforced it — a key added to one and missed in another is dropped
 * silently at proposal validation, with no error anywhere. This is that guard.
 */
describe("brand_fields lockstep", () => {
  const expected = [...brandFieldKeys].sort();

  it("matches the extraction schema", () => {
    expect(Object.keys(extractionSchema.shape.fields.shape).sort()).toEqual(
      expected,
    );
  });

  it("matches the propose_brand_field_updates tool", () => {
    const tools = buildProposeTools({ userId: "u1", brandId: "b1" });
    const schema = tools.propose_brand_field_updates.inputSchema as unknown as {
      shape: { fields: { shape: Record<string, unknown> } };
    };
    expect(Object.keys(schema.shape.fields.shape).sort()).toEqual(expected);
  });

  it("includes additionalColors on every side", () => {
    expect(expected).toContain("additionalColors");
  });
});
