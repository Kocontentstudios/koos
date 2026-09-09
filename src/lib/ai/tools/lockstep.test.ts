import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/queries", () => ({ checkBrandAccess: vi.fn() }));

import { extractionSchema } from "@/lib/ai/onboarding/extraction";
import { brandFieldKeys, ProposalSchema } from "./proposals";
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

  /* extract/route.ts runs ProposalSchema.safeParse on the built proposal, and
     zod STRIPS unknown keys rather than failing — so a key missing here is
     dropped silently between extraction and the confirm card, which is exactly
     what extraction.ts's comment warns about. */
  it("matches the ProposalSchema brand_fields member", () => {
    const parsed = ProposalSchema.parse({
      kind: "brand_fields",
      summary: "s",
      data: {
        fields: Object.fromEntries(brandFieldKeys.map((k) => [k, "v"])),
      },
    });
    expect(
      Object.keys(
        (parsed.data as { fields: Record<string, string> }).fields,
      ).sort(),
    ).toEqual(expected);
  });

  /* These two columns are mirror images and the descriptions are the model's
     only basis for telling them apart. The inversion they prevent is otherwise
     checked solely by the paid eval, so the free lane pins that each one names
     whose advantage it holds. */
  it.each([
    ["competitorStrengths", /competitors/i, /this brand/i],
    ["differentiators", /this brand/i, /competitors/i],
  ] as const)("%s says whose advantage it holds", (field, owns, disowns) => {
    const description = extractionSchema.shape.fields.shape[field].description;
    expect(description).toBeTruthy();
    expect(description).toMatch(owns);
    expect(description).toMatch(/never/i);
    expect(description).toMatch(disowns);
  });

  it("includes additionalColors on every side", () => {
    expect(expected).toContain("additionalColors");
  });
});
