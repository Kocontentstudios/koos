import { describe, expect, it, vi } from "vitest";

/* brandSummaryFrom is pure, but its module imports getBrandVoiceGuide, which
   pulls in the db client and throws without DATABASE_URL. Mocked so this file
   tests the mapping rather than the environment — the import arrived from dev
   after this branch was cut, so the test passed here and failed on the merge. */
vi.mock("@/lib/db/queries", () => ({ getBrandVoiceGuide: vi.fn() }));

import { brandBlock } from "@/lib/ai/prompts/strategy";
import type { brands } from "@/lib/db/schema";
import { brandSummaryFrom } from "@/lib/jobs/brand-summary";

type BrandRow = typeof brands.$inferSelect;

function row(overrides: Partial<BrandRow> = {}): BrandRow {
  return {
    name: "Lagos Loom",
    competitors: "Zara Home",
    competitorStrengths: "Bigger budget",
    differentiators: "Heritage craft",
    ...overrides,
  } as BrandRow;
}

/* The mapping is the only thing carrying a brand column into every AI prompt.
   Dropping one line here is silent: the field stays in the database, the form
   still shows it, and the model simply never sees it again. */
describe("brandSummaryFrom", () => {
  it("carries both sides of the competitor picture into the prompt", () => {
    const block = brandBlock(brandSummaryFrom(row()));
    expect(block).toContain("Competitors: Zara Home");
    expect(block).toContain("How they differ: Heritage craft");
    expect(block).toContain("Where competitors are strong: Bigger budget");
  });

  it("omits what the brand has not answered", () => {
    const block = brandBlock(
      brandSummaryFrom(row({ competitorStrengths: null })),
    );
    expect(block).not.toContain("competitors are strong");
  });
});
