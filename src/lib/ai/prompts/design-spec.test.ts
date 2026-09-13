import { describe, expect, it } from "vitest";
import {
  brandPalette,
  buildDesignSpecSystemPrompt,
  buildNativePrompt,
} from "./design-spec";
import { brandBlock, buildStrategyGenerationPrompt } from "./strategy";

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

/* The paid eval:strategy suite scores buildStrategyGenerationPrompt, and its
   cases carry no competitor fields. A new brandBlock line must therefore be
   absent-by-default, or every eval baseline shifts for reasons unrelated to
   the model. */
describe("brandBlock is absent-by-default", () => {
  it("adds nothing for a brand with no competitor strengths", () => {
    const base = { name: "Lagos Loom", overview: "Handwoven bags" };
    expect(brandBlock(base)).toBe(
      brandBlock({ ...base, competitorStrengths: null }),
    );
    expect(brandBlock(base)).not.toContain("competitors are strong");
  });

  it("emits the line only once the field is filled", () => {
    const block = brandBlock({
      name: "Lagos Loom",
      competitorStrengths: "Bigger budget, Wider reach",
    });
    expect(block).toContain("Where competitors are strong: Bigger budget");
  });

  /* The two competitor lines answer opposite questions; collapsing them would
     tell the strategist to avoid its own advantages. */
  it("keeps our differentiators separate from theirs", () => {
    const block = brandBlock({
      name: "Lagos Loom",
      differentiators: "Heritage craft",
      competitorStrengths: "Bigger budget",
    });
    expect(block).toContain("How they differ: Heritage craft");
    expect(block).toContain("Where competitors are strong: Bigger budget");
  });
});

/* Acceptance criterion 3: differentiation must reach the strategy engine.
   Deleting the directive left every test green, which meant the criterion had
   no guard at all. */
describe("the strategy prompt acts on positioning", () => {
  const bare = { name: "Lagos Loom", overview: "Handwoven bags" };
  const build = (brand: Parameters<typeof buildStrategyGenerationPrompt>[1]) =>
    buildStrategyGenerationPrompt("we talked about a launch", brand);

  it("tells the strategist to build the message on the difference", () => {
    expect(build({ ...bare, differentiators: "Heritage craft" })).toMatch(
      /key message on how this brand differs/i,
    );
  });

  it("tells it to aim away from where competitors are strong", () => {
    expect(build({ ...bare, competitorStrengths: "Bigger budget" })).toMatch(
      /aim at the gap/i,
    );
  });

  /* This prompt is the one the paid eval:strategy suite scores, and its cases
     carry no competitor fields — an unconditional paragraph is pure noise on
     every baseline. */
  it("adds nothing for a brand that has said neither", () => {
    expect(build(bare)).toBe(build({ ...bare, differentiators: null }));
    expect(build(bare)).not.toMatch(/key message on how|aim at the gap/i);
  });

  it("adds only the half the brand has answered", () => {
    const onlyOurs = build({ ...bare, differentiators: "Heritage craft" });
    expect(onlyOurs).not.toMatch(/aim at the gap/i);
    const onlyTheirs = build({ ...bare, competitorStrengths: "Bigger budget" });
    expect(onlyTheirs).not.toMatch(/key message on how/i);
  });
});

describe("the logo rule", () => {
  const withLogo = buildDesignSpecSystemPrompt(brand, true);
  const withoutLogo = buildDesignSpecSystemPrompt(brand, false);

  /* The bug this rule exists for: logoPlacement is an enum containing "none"
     and the prompt said nothing about it at all, so the art director picked
     "none" freely and the brand's mark never reached a design. */
  it("tells a brand with a logo that one is coming", () => {
    expect(withLogo).toMatch(/this brand has a logo/i);
    expect(withLogo).toMatch(/never "none"/i);
  });

  it("asks for the emptiest corner rather than a fixed one", () => {
    expect(withLogo).toMatch(/emptiest/i);
    expect(withLogo).not.toMatch(/always use the top[- ]right/i);
  });

  /* The plate and native prompts render the artwork; the real logo file is
     composited afterwards. A model that draws its own would produce two. */
  it("forbids asking the image model to draw a logo", () => {
    expect(withLogo).toMatch(
      /do not describe or ask for a logo in "backgroundPrompt" or "nativePrompt"/i,
    );
  });

  it("tells a brand without a logo not to leave a gap", () => {
    expect(withoutLogo).toMatch(/no logo on file/i);
    expect(withoutLogo).toMatch(/"none"/);
    expect(withoutLogo).not.toMatch(/this brand has a logo/i);
  });

  it("keeps the palette rule either way", () => {
    for (const prompt of [withLogo, withoutLogo]) {
      expect(prompt).toMatch(/"palette" must be drawn from the brand colours/);
    }
  });
});

describe("buildNativePrompt's logo clause", () => {
  const spec = {
    layout: "hero-center",
    headline: "Launch week",
    palette: { background: "#000", foreground: "#fff", accent: "#f00" },
    logoPlacement: "top-right",
    backgroundPrompt: "a skyline",
    backgroundTreatment: "photographic",
    nativePrompt: "a launch poster",
    aspectRatio: "1:1",
  } as const;

  it("asks for a clear corner, not for a drawn logo", () => {
    const prompt = buildNativePrompt(spec as never, brand);
    expect(prompt).toMatch(/leave the top right corner clear/i);
    expect(prompt).toMatch(/do not draw a logo yourself/i);
  });

  /* The shipped nonsense: "none" fell through to the same sentence with the
     placement interpolated raw, so a logo-free design was told to leave clear
     space in "the none corner". */
  it("never speaks of a none corner", () => {
    const prompt = buildNativePrompt(
      { ...spec, logoPlacement: "none" } as never,
      brand,
    );
    expect(prompt).not.toMatch(/none corner/i);
    expect(prompt).toMatch(/do not include a logo/i);
    expect(prompt).toMatch(/do not leave a gap/i);
  });

  it("keeps the visual style line independent of the logo", () => {
    const styled = { ...brand, brandStyle: "Minimal and monochrome" };
    for (const placement of ["top-right", "none"] as const) {
      expect(
        buildNativePrompt(
          { ...spec, logoPlacement: placement } as never,
          styled,
        ),
      ).toMatch(/visual style is: Minimal and monochrome/);
    }
    expect(buildNativePrompt(spec as never, brand)).not.toMatch(
      /visual style is:/,
    );
  });

  it("still carries the exact copy and palette", () => {
    const prompt = buildNativePrompt(spec as never, brand);
    expect(prompt).toContain('Headline: "Launch week"');
    expect(prompt).toContain("Background colour #000");
  });
});
