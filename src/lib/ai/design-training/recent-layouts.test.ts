import { describe, expect, it } from "vitest";
import { layoutMemoryBlock, recentLayouts } from "./recent-layouts";

/* KOOS-AI-001 §1.5. Module 06 §7-8: before making a new design, compare it
   with recent ones and prefer a layout family that has not been overused.
   `design_generations.spec` has recorded every layout chosen since the feature
   shipped and was never read back, so each generation re-rolled blind and the
   same composition could repeat indefinitely. */
describe("recentLayouts", () => {
  const row = (layout: string) => ({ spec: { layout } });

  it("reads the layouts back newest first, as stored", () => {
    expect(
      recentLayouts([row("hero-center"), row("split-left"), row("quote-card")]),
    ).toEqual(["hero-center", "split-left", "quote-card"]);
  });

  /* The spec column is jsonb written by a model: a row from before the field
     existed, or one the model filled oddly, must not throw on the way to a
     prompt. */
  it.each([
    [{ spec: null }],
    [{ spec: {} }],
    [{ spec: { layout: "" } }],
    [{ spec: { layout: 42 } }],
    [{ spec: "not an object" }],
    [{}],
  ])("skips the unusable row %j", (bad) => {
    expect(recentLayouts([bad, row("split-left")])).toEqual(["split-left"]);
  });

  it("looks only as far back as asked", () => {
    const rows = [row("a"), row("b"), row("c"), row("d")];

    expect(recentLayouts(rows, { limit: 2 })).toEqual(["a", "b"]);
  });

  it("returns nothing for a brand that has generated nothing", () => {
    expect(recentLayouts([])).toEqual([]);
  });
});

describe("layoutMemoryBlock", () => {
  it("says nothing at all when there is no history to compare against", () => {
    expect(layoutMemoryBlock([])).toBe("");
  });

  it("names the layouts recently used so they can be avoided", () => {
    const block = layoutMemoryBlock([
      "hero-center",
      "hero-center",
      "split-left",
    ]);

    expect(block).toMatch(/hero-center/);
    expect(block).toMatch(/split-left/);
  });

  /* The pressure has to be proportional: one prior use is not a rut, three of
     the last three is. */
  it("presses harder when one layout dominates the recent work", () => {
    const repeated = layoutMemoryBlock([
      "hero-center",
      "hero-center",
      "hero-center",
    ]);
    const varied = layoutMemoryBlock([
      "hero-center",
      "split-left",
      "quote-card",
    ]);

    expect(repeated).toMatch(/every|all three|repeatedly|last three/i);
    expect(repeated).not.toBe(varied);
  });

  /* Module 06 §8: repetition is correct for a deliberate series or an
     identical information structure. An anti-repetition rule with no exception
     would break campaign consistency, which module 10 exists to protect. */
  it("allows a repeat when the work is a series", () => {
    expect(layoutMemoryBlock(["hero-center", "hero-center"])).toMatch(
      /series|same information|deliberate/i,
    );
  });

  it("asks for a different family rather than a random one", () => {
    expect(layoutMemoryBlock(["hero-center"])).toMatch(
      /not.*random|suits the content|fits the content/i,
    );
  });
});
