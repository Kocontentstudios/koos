import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { brands } from "./schema";

/**
 * KOS-V1-BUG-011: brand setup completion had two sources of truth — a stored
 * brands.completion_percentage written at save time, and brandProfileCompletion
 * computed from the row. Nothing displayed the column and the two disagreed on
 * every brand written before the weights changed. Dropping it left one
 * definition; re-adding it silently restores the divergence, because a stored
 * copy goes stale the moment a weight or a scored field moves.
 */
describe("brands has no stored completion column", () => {
  const columns = getTableColumns(brands);

  it("exposes no completionPercentage property", () => {
    expect(columns).not.toHaveProperty("completionPercentage");
  });

  it("maps no column to completion_percentage", () => {
    expect(Object.values(columns).map((c) => c.name)).not.toContain(
      "completion_percentage",
    );
  });
});
