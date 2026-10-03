import { describe, expect, it } from "vitest";
import { anchorsBlock, brandAnchors } from "./anchors";

/* KOOS-AI-001 §1.4. Module 06 §1 splits a brand into three layers: fixed
   anchors that should rarely change, controlled variables that may move inside
   a range, and free campaign elements that should respond to each message.
   The art director was told none of this, so it had no way to know that moving
   the logo is allowed and recolouring it is not. */
describe("brandAnchors", () => {
  const full = {
    name: "Okra Kitchen",
    primaryColor: "forest green",
    brandFont: "Bricolage Grotesque",
    brandStyle: "warm editorial",
    tone: "warm, direct",
  };

  it("treats the brand's own identity as fixed", () => {
    const { fixed } = brandAnchors(full, { hasLogo: true });

    expect(fixed.join(" ")).toMatch(/logo/i);
    expect(fixed.join(" ")).toMatch(/colour|color/i);
  });

  /* Absent-by-default, the same rule brandBlock follows: a brand with no font
     on file must not have one described, or the model will reference a
     typeface that does not exist and the renderer cannot honour it. */
  it("claims no typeface for a brand that has none", () => {
    const { fixed } = brandAnchors(
      { name: "Okra Kitchen" },
      { hasLogo: false },
    );

    expect(fixed.join(" ")).not.toMatch(/typeface|font/i);
  });

  it("claims no logo anchor for a brand without one", () => {
    const { fixed } = brandAnchors(full, { hasLogo: false });

    expect(fixed.join(" ")).not.toMatch(/logo/i);
  });

  /* Module 06 §5: these are the dimensions a new design is ALLOWED to move.
     Without them the model either repeats one composition or changes
     everything at once, and both are documented failures. */
  it("names what may vary within the brand", () => {
    const { controlled } = brandAnchors(full, { hasLogo: true });

    expect(controlled.join(" ")).toMatch(/position|placement/i);
    expect(controlled.join(" ")).toMatch(/light|dark/i);
  });

  it("names what belongs to the campaign rather than the brand", () => {
    const { free } = brandAnchors(full, { hasLogo: true });

    expect(free.join(" ")).toMatch(/headline/i);
    expect(free.join(" ")).toMatch(/scene|metaphor/i);
  });
});

describe("anchorsBlock", () => {
  const brand = { name: "Okra Kitchen", primaryColor: "forest green" };

  it("separates the three layers so the model can tell them apart", () => {
    const block = anchorsBlock(brand, { hasLogo: true });

    expect(block).toMatch(/fixed/i);
    expect(block).toMatch(/vary|controlled/i);
    expect(block).toMatch(/campaign/i);
  });

  /* Module 06 §4. The threshold is what stops "controlled variation" becoming
     a different brand every week. */
  it("states the minimum recognition threshold", () => {
    expect(anchorsBlock(brand, { hasLogo: true })).toMatch(
      /at least|retain|keep/i,
    );
  });

  /* Module 06 §5's closing rule, and the one most worth repeating: changing
     everything at once is as wrong as changing nothing. */
  it("warns against moving every dimension at once", () => {
    expect(anchorsBlock(brand, { hasLogo: true })).toMatch(
      /not every|two or three|at once/i,
    );
  });

  it("says nothing about a logo the brand does not have", () => {
    expect(anchorsBlock(brand, { hasLogo: false })).not.toMatch(/logo/i);
  });
});
