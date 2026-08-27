import { describe, expect, it } from "vitest";
import { brandPalette } from "./design-spec";
import { brandBlock } from "./strategy";

const brand = { name: "Lagos Loom" };

describe("brandPalette", () => {
  it("lists every saved colour, most important first", () => {
    expect(
      brandPalette({
        ...brand,
        primaryColor: "#0F172A",
        secondaryColor: "#F97316",
        additionalColors: ["#22C55E", "#EAB308"],
      }),
    ).toBe(
      "\nBrand colours, most important first: #0F172A, #F97316, #22C55E, #EAB308",
    );
  });

  it("emits nothing when the brand has no colours", () => {
    expect(brandPalette(brand)).toBe("");
    expect(
      brandPalette({ ...brand, primaryColor: null, additionalColors: [] }),
    ).toBe("");
  });

  it("skips blanks rather than emitting empty slots", () => {
    expect(
      brandPalette({
        ...brand,
        primaryColor: "  ",
        secondaryColor: "#F97316",
        additionalColors: [""],
      }),
    ).toBe("\nBrand colours, most important first: #F97316");
  });

  /* The conversational path stores names, and a name still steers the art
     director — which answers with a real hex. Filtering to hex here would
     discard exactly what that path produces. */
  it("passes colour names through verbatim", () => {
    expect(brandPalette({ ...brand, primaryColor: "forest green" })).toContain(
      "forest green",
    );
  });

  it("caps at three additional colours even if the column holds more", () => {
    const out = brandPalette({
      ...brand,
      additionalColors: ["#1", "#2", "#3", "#4"],
    });
    expect(out).toContain("#3");
    expect(out).not.toContain("#4");
  });
});

describe("brandBlock stays colour-free", () => {
  /* Six prompts consume brandBlock and only the design prompts can act on
     colour. Emitting it here would perturb buildStrategyGenerationPrompt,
     the one prompt the paid eval:strategy suite scores. */
  it("does not leak colours into the shared brand block", () => {
    const block = brandBlock({
      ...brand,
      primaryColor: "#0F172A",
      secondaryColor: "#F97316",
      additionalColors: ["#22C55E"],
    });
    expect(block).not.toContain("#0F172A");
    expect(block).not.toContain("#22C55E");
  });
});
