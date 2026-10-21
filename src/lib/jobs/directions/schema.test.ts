import { describe, expect, it } from "vitest";
import { readRationale, storedRationale } from "./schema";

describe("rationale storage", () => {
  it("round-trips title, reasons, set and slot", () => {
    const stored = storedRationale(
      { title: "Morning bake story", rationale: ["a", "b"] },
      "set-1",
      1,
    );
    expect(readRationale(stored)).toEqual({
      title: "Morning bake story",
      reasons: ["a", "b"],
      set: "set-1",
      slot: 1,
    });
  });

  it("reads a row that is not a direction as null", () => {
    expect(readRationale(null)).toBeNull();
    expect(readRationale({ reasons: [] })).toBeNull();
  });
});
