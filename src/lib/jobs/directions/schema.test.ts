import { describe, expect, it } from "vitest";
import { currentSibling } from "./schema";

describe("currentSibling", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 21, 9, minute));
  const row = (
    id: string,
    slot: number,
    minute: number,
    status = "succeeded",
    set = "set-1",
  ) => ({
    id,
    status,
    createdAt: at(minute),
    rationale: { title: id, reasons: [], set, slot },
  });
  const of = (id: string, slot: number) => ({ id, set: "set-1", slot });

  it("is the other slot of the same set", () => {
    const rows = [row("a", 0, 1), row("b", 1, 1)];
    expect(currentSibling(rows, of("a", 0))?.id).toBe("b");
  });

  it("follows regenerations by slot, not by recency", () => {
    const rows = [
      row("a", 0, 1),
      row("b", 1, 1),
      row("c", 0, 2),
      row("e", 0, 3),
    ];
    expect(currentSibling(rows, of("e", 0))?.id).toBe("b");
    expect(currentSibling(rows, of("b", 1))?.id).toBe("e");
  });

  it("skips pending and failed rows and other sets", () => {
    const rows = [
      row("a", 0, 1),
      row("b", 1, 1),
      row("p", 1, 5, "pending"),
      row("f", 1, 6, "failed"),
      row("x", 1, 7, "succeeded", "set-2"),
    ];
    expect(currentSibling(rows, of("a", 0))?.id).toBe("b");
  });

  /* Round-1 regression: the set was read newest first with a cap of 20, so a
     slot regenerated 20 times pushed the sibling out of the read and the
     next regenerate could land on its layout. */
  it("still finds the sibling behind 25 newer rows in one slot", () => {
    const churn = Array.from({ length: 25 }, (_, i) =>
      row(`r${i}`, 0, 10 + i, i % 3 === 0 ? "failed" : "succeeded"),
    );
    const rows = [...churn.reverse(), row("b", 1, 1), row("a", 0, 0)];
    expect(currentSibling(rows, of("r24", 0))?.id).toBe("b");
  });

  it("is null when the set has no other slot", () => {
    expect(currentSibling([row("a", 0, 1)], of("a", 0))).toBeNull();
  });
});
