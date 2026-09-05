import { describe, expect, it } from "vitest";
import { deliveryPatchFor } from "./delivery";

const NOW = new Date("2026-09-04T12:00:00Z");

/* The only writer of delivered_at, and it had no test: deleting the write, or
   relaxing `version === 1` so every correction round overwrites it, both passed
   the full suite. Three comments in three files say the second must not happen. */
describe("deliveryPatchFor", () => {
  it("stamps the delivery date on the first round", () => {
    expect(deliveryPatchFor(1, NOW)).toEqual({
      status: "ready_for_review",
      updatedAt: NOW,
      deliveredAt: NOW,
    });
  });

  /* The regression the column exists to avoid: a January ticket revised in
     September must not read as delivered in September. */
  it.each([2, 3, 12])("leaves it alone on round %i", (version) => {
    const patch = deliveryPatchFor(version, NOW);
    expect(patch).not.toHaveProperty("deliveredAt");
    expect(Object.keys(patch).sort()).toEqual(["status", "updatedAt"]);
  });

  it("moves every round into review", () => {
    for (const version of [1, 2, 9]) {
      expect(deliveryPatchFor(version, NOW).status).toBe("ready_for_review");
    }
  });

  /* A patch that omits updatedAt would leave the ticket looking untouched. */
  it("always touches updatedAt", () => {
    for (const version of [1, 2]) {
      expect(deliveryPatchFor(version, NOW).updatedAt).toBe(NOW);
    }
  });
});
