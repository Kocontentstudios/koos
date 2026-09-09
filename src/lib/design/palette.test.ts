import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  ensureReadablePair,
  MIN_CONTRAST_RATIO,
  normalizeHex,
  resolvePalette,
} from "./palette";

describe("normalizeHex", () => {
  it("expands shorthand and upper-cases", () => {
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    expect(normalizeHex("aabbcc")).toBe("#AABBCC");
  });

  it("rejects what a model might emit instead of hex", () => {
    for (const bad of ["rgb(0,0,0)", "cornflowerblue", "", null, undefined]) {
      expect(normalizeHex(bad)).toBeNull();
    }
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
  });

  it("is 1 for a colour against itself", () => {
    expect(contrastRatio("#3A7BD5", "#3A7BD5")).toBeCloseTo(1, 5);
  });
});

describe("ensureReadablePair", () => {
  it("keeps both colours untouched when they already pass", () => {
    expect(ensureReadablePair("#000000", "#FFFFFF")).toEqual({
      foreground: "#000000",
      background: "#FFFFFF",
    });
  });

  it("prefers swapping text before touching the brand background", () => {
    const result = ensureReadablePair("#808080", "#F5F5F5");
    expect(result.background).toBe("#F5F5F5");
    expect(result.foreground).toBe("#111111");
  });

  it("meets the contrast bar for every background, including mid-tones", () => {
    const backgrounds = [
      "#FFFFFF",
      "#000000",
      "#1A1A1A",
      "#F5F5F5",
      "#3A7BD5",
      "#767676",
      "#7A7A7A",
      "#808080",
    ];
    for (const bg of backgrounds) {
      const { foreground, background } = ensureReadablePair("#808080", bg);
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(
        MIN_CONTRAST_RATIO,
      );
    }
  });

  it("nudges the background only when text alone cannot pass", () => {
    // Mid-luminance: neither pure black nor pure white clears 4.5:1 unaided.
    const midTone = "#777777";
    const blackOnly = contrastRatio("#111111", midTone);
    const whiteOnly = contrastRatio("#FFFFFF", midTone);
    expect(Math.max(blackOnly, whiteOnly)).toBeLessThan(MIN_CONTRAST_RATIO);

    const result = ensureReadablePair("#808080", midTone);
    expect(result.background).not.toBe(midTone);
    expect(normalizeHex(result.background)).toBe(result.background);
  });
});

describe("resolvePalette", () => {
  const brand = { primaryColor: "#0F172A", secondaryColor: "#F97316" };

  it("uses the model's colours when they are valid hex", () => {
    expect(
      resolvePalette(
        { background: "#FFFFFF", foreground: "#111111", accent: "#2563EB" },
        brand,
      ),
    ).toEqual({
      background: "#FFFFFF",
      foreground: "#111111",
      accent: "#2563EB",
    });
  });

  it("falls back to brand colours when the model emits garbage", () => {
    const result = resolvePalette(
      { background: "navy blue", foreground: "rgb(1,2,3)", accent: "???" },
      brand,
    );
    expect(result.background).toBe("#0F172A");
    expect(result.accent).toBe("#F97316");
  });

  it("never returns a non-hex value, even with no input at all", () => {
    const result = resolvePalette(null, {
      primaryColor: null,
      secondaryColor: null,
    });
    for (const value of Object.values(result)) {
      expect(normalizeHex(value)).toBe(value);
    }
  });

  it("guarantees readable foreground on a dark brand background", () => {
    const result = resolvePalette(
      { background: "#0F172A", foreground: "#111111", accent: "#F97316" },
      brand,
    );
    expect(
      contrastRatio(result.foreground, result.background),
    ).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
  });
});

describe("resolvePalette additional brand colours", () => {
  it("falls back to the first additional colour when secondary is absent", () => {
    const p = resolvePalette(null, {
      primaryColor: "#0F172A",
      secondaryColor: null,
      additionalColors: ["#F97316", "#22C55E"],
    });
    expect(p.accent).toBe("#F97316");
  });

  it("prefers secondary over the additional colours", () => {
    const p = resolvePalette(null, {
      primaryColor: "#0F172A",
      secondaryColor: "#F97316",
      additionalColors: ["#22C55E"],
    });
    expect(p.accent).toBe("#F97316");
  });

  /* The AI path stores names like "forest green"; the renderer needs a real
     value, so non-hex entries are skipped rather than passed through. */
  it("skips non-hex entries and uses the first usable one", () => {
    const p = resolvePalette(null, {
      primaryColor: "#0F172A",
      secondaryColor: null,
      additionalColors: ["forest green", "#22C55E"],
    });
    expect(p.accent).toBe("#22C55E");
  });

  it("still falls back to primary when no additional colour is usable", () => {
    const p = resolvePalette(null, {
      primaryColor: "#0F172A",
      secondaryColor: null,
      additionalColors: ["forest green"],
    });
    expect(p.accent).toBe("#0F172A");
  });

  it("leaves background and foreground unaffected by additional colours", () => {
    const withExtra = resolvePalette(null, {
      primaryColor: "#0F172A",
      secondaryColor: null,
      additionalColors: ["#F97316"],
    });
    const without = resolvePalette(null, {
      primaryColor: "#0F172A",
      secondaryColor: null,
    });
    expect(withExtra.background).toBe(without.background);
    expect(withExtra.foreground).toBe(without.foreground);
  });
});
