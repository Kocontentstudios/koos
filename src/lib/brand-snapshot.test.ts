import { describe, expect, it } from "vitest";
import {
  identityLine,
  paletteSwatches,
  toneBadges,
} from "@/lib/brand-snapshot";

describe("toneBadges", () => {
  /* The design shows one adjective per badge, and every canonical tone option
     is a compound joined by "&" — so the ampersand is a separator here, not
     part of the value. */
  it("splits the canonical compound options into single adjectives", () => {
    expect(toneBadges("Friendly & Educational")).toEqual([
      "Friendly",
      "Educational",
    ]);
    expect(toneBadges("Warm & Community-Driven")).toEqual([
      "Warm",
      "Community-Driven",
    ]);
  });

  it("splits the list forms the conversational path produces", () => {
    expect(toneBadges("Elegant, Warm, Sophisticated, Timeless")).toEqual([
      "Elegant",
      "Warm",
      "Sophisticated",
      "Timeless",
    ]);
    expect(toneBadges("bold; direct")).toEqual(["bold", "direct"]);
    expect(toneBadges("playful / cheeky")).toEqual(["playful", "cheeky"]);
    expect(toneBadges("warm and honest")).toEqual(["warm", "honest"]);
  });

  it("keeps a single adjective as one badge", () => {
    expect(toneBadges("Timeless")).toEqual(["Timeless"]);
  });

  it("drops duplicates and trailing punctuation", () => {
    expect(toneBadges("Warm, warm, WARM.")).toEqual(["Warm"]);
  });

  /* A tone with no separators and a sentence's worth of words is prose. Forcing
     it into a pill would produce one badge the width of the card. */
  it("returns nothing for prose, so the caller can render it as text", () => {
    expect(
      toneBadges("we speak like a friend who already knows fashion"),
    ).toEqual([]);
  });

  it("rejects the whole thing when any one fragment is oversized", () => {
    expect(
      toneBadges("Warm, and we never sound like a corporate press release"),
    ).toEqual([]);
  });

  it("caps the badge count", () => {
    expect(toneBadges("a, b, c, d, e, f, g, h")).toHaveLength(6);
  });

  it("handles empty input", () => {
    expect(toneBadges(null)).toEqual([]);
    expect(toneBadges(undefined)).toEqual([]);
    expect(toneBadges("   ")).toEqual([]);
    expect(toneBadges(",,,")).toEqual([]);
  });
});

describe("paletteSwatches", () => {
  it("orders primary, secondary, then the additional colours", () => {
    expect(
      paletteSwatches({
        primaryColor: "#3a2a1f",
        secondaryColor: "#faf7f2",
        additionalColors: ["#d4b8a0"],
      }).map((s) => s.hex),
    ).toEqual(["#3A2A1F", "#FAF7F2", "#D4B8A0"]);
  });

  /* Colours are stored unvalidated on purpose: the conversational path keeps
     what the user said. A colour name must not paint an invisible dot. */
  it("marks a colour name as unrenderable but keeps what the user said", () => {
    const [swatch] = paletteSwatches({ primaryColor: "deep forest green" });
    expect(swatch).toEqual({ value: "deep forest green", hex: null });
  });

  it("expands shorthand hex", () => {
    expect(paletteSwatches({ primaryColor: "#fff" })[0].hex).toBe("#FFFFFF");
  });

  it("accepts a hex with no leading hash", () => {
    expect(paletteSwatches({ primaryColor: "3a2a1f" })[0].hex).toBe("#3A2A1F");
  });

  it("skips blanks and nulls", () => {
    expect(
      paletteSwatches({
        primaryColor: null,
        secondaryColor: "  ",
        additionalColors: null,
      }),
    ).toEqual([]);
  });

  it("drops a repeated colour", () => {
    expect(
      paletteSwatches({
        primaryColor: "#FFF000",
        secondaryColor: "#fff000",
      }),
    ).toHaveLength(1);
  });

  it("respects the additional-colour cap", () => {
    expect(
      paletteSwatches({
        primaryColor: "#111111",
        secondaryColor: "#222222",
        additionalColors: ["#333333", "#444444", "#555555", "#666666"],
      }),
    ).toHaveLength(5);
  });
});

describe("identityLine", () => {
  it("joins both halves with a dash", () => {
    expect(identityLine("Modest Fashion", "Womenswear")).toBe(
      "Modest Fashion — Womenswear",
    );
  });

  it("shows whichever half exists on its own, with no stray dash", () => {
    expect(identityLine("Retail", null)).toBe("Retail");
    expect(identityLine(null, "Growth")).toBe("Growth");
    expect(identityLine("  ", "Growth")).toBe("Growth");
  });

  it("is null when neither is set", () => {
    expect(identityLine(null, null)).toBeNull();
    expect(identityLine("", "  ")).toBeNull();
  });
});
