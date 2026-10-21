import { describe, expect, it } from "vitest";
import { DESIGN_LAYOUTS } from "@/lib/design/spec";
import { distinctLayout, forceDistinctLayouts } from "./layouts";

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
