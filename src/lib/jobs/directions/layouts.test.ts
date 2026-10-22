import { describe, expect, it } from "vitest";
import { DESIGN_LAYOUTS } from "@/lib/design/spec";
import {
  distinctLayout,
  forceDistinctLayouts,
  layoutCandidates,
  layoutsHeld,
} from "./layouts";

describe("distinctLayout", () => {
  it("keeps the proposal when no sibling holds it", () => {
    expect(distinctLayout("split-left", ["hero-center"], ["split-left"])).toBe(
      "split-left",
    );
  });

  it("moves a taken layout to the first free one not in recent memory", () => {
    expect(
      distinctLayout(
        "hero-center",
        ["hero-center"],
        ["split-left", "banner-bottom"],
      ),
    ).toBe("quote-card");
  });

  it("lets memory yield before distinctness when every free layout is recent", () => {
    const recent = DESIGN_LAYOUTS.filter((l) => l !== "hero-center");
    expect(distinctLayout("hero-center", ["hero-center"], recent)).toBe(
      "split-left",
    );
  });

  it("avoids every taken layout at once, as a regenerated direction must", () => {
    expect(
      distinctLayout("split-left", ["split-left", "hero-center"], []),
    ).toBe("banner-bottom");
  });

  it("returns the proposal only when every layout is taken", () => {
    expect(distinctLayout("quote-card", [...DESIGN_LAYOUTS], [])).toBe(
      "quote-card",
    );
  });
});

describe("forceDistinctLayouts", () => {
  it("gives the second direction a new layout when the model repeats one", () => {
    expect(forceDistinctLayouts(["hero-center", "hero-center"], [])).toEqual([
      "hero-center",
      "split-left",
    ]);
  });

  it("steers the swap away from the brand's recent layouts", () => {
    expect(
      forceDistinctLayouts(
        ["quote-card", "quote-card"],
        ["hero-center", "split-left", "quote-card"],
      ),
    ).toEqual(["quote-card", "banner-bottom"]);
  });

  it("leaves two different layouts alone, even ones in recent memory", () => {
    expect(
      forceDistinctLayouts(["banner-bottom", "split-left"], ["split-left"]),
    ).toEqual(["banner-bottom", "split-left"]);
  });

  it("keeps a regenerated direction off the original's and its sibling's layouts", () => {
    expect(
      forceDistinctLayouts(["hero-center"], [], ["hero-center", "quote-card"]),
    ).toEqual(["split-left"]);
  });

  it("always yields pairwise-different layouts for every possible proposal", () => {
    for (const a of DESIGN_LAYOUTS) {
      for (const b of DESIGN_LAYOUTS) {
        for (const recent of [[], [a], [a, b], [...DESIGN_LAYOUTS]]) {
          const [x, y] = forceDistinctLayouts([a, b], recent);
          expect(x).not.toBe(y);
        }
      }
    }
  });
});

describe("layoutsHeld", () => {
  const SET = "set-1";
  const now = new Date("2026-10-22T12:00:00Z");
  const row = (
    id: string,
    slot: number,
    layout: string,
    status: string,
    minutesAgo: number,
  ) => ({
    id,
    status,
    spec: { layout },
    rationale: { set: SET, slot, title: "t", reasons: [] },
    createdAt: new Date(now.getTime() - minutesAgo * 60_000),
  });

  it("holds the sibling's shown layout and the one being replaced", () => {
    const rows = [
      row("a", 0, "hero-center", "succeeded", 10),
      row("b", 1, "split-left", "succeeded", 10),
      row("new", 0, "hero-center", "pending", 0),
    ];
    expect(
      layoutsHeld(
        rows,
        { id: "new", set: SET, slot: 0, replacing: "a" },
        now,
      ).sort(),
    ).toEqual(["hero-center", "split-left"]);
  });

  /* Round-2 code critic: two regenerates on the two slots each read the
     same old pair and picked the same layout. Under the lock, the second
     sees the first's pending row and its claimed layout. */
  it("holds what a concurrent regenerate on the other slot claimed", () => {
    const rows = [
      row("a", 0, "hero-center", "succeeded", 10),
      row("b", 1, "split-left", "succeeded", 10),
      row("a2", 0, "banner-bottom", "pending", 1),
      row("b2", 1, "banner-bottom", "pending", 0),
    ];
    expect(
      layoutsHeld(rows, { id: "b2", set: SET, slot: 1, replacing: "b" }, now),
    ).toContain("banner-bottom");
  });

  it("ignores a pending row from a job that died", () => {
    const rows = [
      row("b", 1, "split-left", "succeeded", 60),
      row("dead", 1, "quote-card", "pending", 30),
    ];
    expect(layoutsHeld(rows, { id: "x", set: SET, slot: 0 }, now)).toEqual([
      "split-left",
    ]);
  });

  it("ignores older rows of its own slot and rows of another set", () => {
    const rows = [
      row("old", 0, "quote-card", "succeeded", 20),
      {
        ...row("other", 1, "stat-highlight", "succeeded", 5),
        rationale: { set: "x", slot: 1 },
      },
    ];
    expect(layoutsHeld(rows, { id: "x", set: SET, slot: 0 }, now)).toEqual([]);
  });
});

describe("layoutCandidates", () => {
  it("tries the proposal first, then every free layout", () => {
    expect(layoutCandidates("quote-card", ["hero-center"])).toEqual([
      "quote-card",
      "split-left",
      "banner-bottom",
      "stat-highlight",
    ]);
  });

  it("never offers a held layout, even the proposal", () => {
    expect(layoutCandidates("hero-center", ["hero-center"])).not.toContain(
      "hero-center",
    );
  });
});
