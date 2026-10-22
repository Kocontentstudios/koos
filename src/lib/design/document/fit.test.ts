import { describe, expect, it } from "vitest";
import {
  balancedWidth,
  fitText,
  glyphOverhang,
  hasOrphan,
  inkOverhang,
  largestFitting,
  lineBox,
  lineCount,
  sizeRange,
  type TextLook,
  unbreakableRuns,
  widthWithoutOrphan,
  wrapSlack,
  wrapWidth,
} from "./fit";
import { monospaceMeasurer } from "./fixtures";

const look = (fontSize: number): TextLook => ({
  font: "heading",
  fontSize,
  fontWeight: 700,
  lineHeight: 1,
  letterSpacing: 0,
  align: "left",
  italic: false,
});

describe("largestFitting", () => {
  it("finds the boundary of a monotonic predicate", async () => {
    for (const boundary of [10, 11, 37, 63, 99, 100]) {
      expect(await largestFitting(10, 100, async (n) => n <= boundary)).toBe(
        boundary,
      );
    }
  });

  it("returns null when even the minimum fails", async () => {
    expect(await largestFitting(10, 100, async () => false)).toBeNull();
  });

  it("returns null for an empty range", async () => {
    expect(await largestFitting(50, 40, async () => true)).toBeNull();
  });

  it("probes logarithmically, not linearly", async () => {
    let probes = 0;
    await largestFitting(10, 140, async (n) => {
      probes += 1;
      return n <= 73;
    });
    expect(probes).toBeLessThanOrEqual(Math.ceil(Math.log2(131)) + 2);
  });

  it("works on fractional bounds by rounding inward", async () => {
    expect(await largestFitting(10.2, 20.8, async () => true)).toBe(20);
  });
});

describe("lineBox and lineCount", () => {
  it("round the line box the way the layout engine does", () => {
    expect(lineBox({ fontSize: 50, lineHeight: 1.05 })).toBe(53);
    expect(lineCount(159, { fontSize: 50, lineHeight: 1.05 })).toBe(3);
  });
});

describe("glyphOverhang", () => {
  it("is larger for tight display leading than for body leading", () => {
    expect(glyphOverhang({ fontSize: 100, lineHeight: 1.05 })).toBeGreaterThan(
      glyphOverhang({ fontSize: 100, lineHeight: 1.35 }),
    );
  });

  it("covers the measured overshoot of the display face at 1.05", () => {
    // Measured: 0.05em above the line box, 0.04em below.
    expect(glyphOverhang({ fontSize: 100, lineHeight: 1.05 })).toBeGreaterThan(
      5,
    );
  });
});

describe("wrap slack", () => {
  /* B4: a box exactly as wide as satori's line wrapped an extra line in
     Chromium. Every run is measured at least 2% narrower than it is drawn. */
  it("leaves at least 2% of the box, and never less than 2px", () => {
    for (const width of [10, 100, 437, 908, 1184]) {
      expect(width - wrapWidth(width)).toBeGreaterThanOrEqual(
        Math.max(2, width * 0.02),
      );
      expect(wrapSlack(width)).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("unbreakableRuns", () => {
  it("splits spaced scripts at spaces", () => {
    expect(unbreakableRuns("  Fresh  pre-order croissants ")).toEqual([
      "Fresh",
      "pre-order",
      "croissants",
    ]);
  });

  /* B7: a CJK sentence has no spaces. Treated as one word, it sent the
     headline to the legibility floor. */
  it("splits CJK at word boundaries, keeping punctuation on the word before", () => {
    const runs = unbreakableRuns("焼きたてのクロワッサンを毎朝お届けします。");
    expect(runs.length).toBeGreaterThan(5);
    expect(runs.join("")).toBe("焼きたてのクロワッサンを毎朝お届けします。");
    expect(runs.at(-1)?.endsWith("。")).toBe(true);
    expect(runs.some((run) => run.startsWith("。"))).toBe(false);
  });
});

describe("sizeRange", () => {
  it("lists every integer from max down to min", () => {
    expect(sizeRange(3, 6)).toEqual([6, 5, 4, 3]);
    expect(sizeRange(3.2, 5.9)).toEqual([5, 4]);
  });
});

describe("fitText", () => {
  it("picks the largest size that fits the box", async () => {
    const measurer = monospaceMeasurer();
    const fitted = await fitText(measurer, {
      text: "ab cd ef gh",
      look,
      width: 100,
      maxHeight: 100,
      sizes: sizeRange(10, 200),
      floor: 10,
    });
    expect(fitted.fits).toBe(true);
    expect(fitted.height).toBeLessThanOrEqual(100);
    const next = look(fitted.fontSize + 1);
    expect(
      (await measurer.height("ab cd ef gh", next, wrapWidth(100))) > 100 ||
        (await measurer.widestWord("ab cd ef gh", next)) > wrapWidth(100),
    ).toBe(true);
  });

  it("only ever takes a size from the list it was given", async () => {
    const ladder = [119, 103, 84, 71, 63, 52, 43];
    const fitted = await fitText(monospaceMeasurer(), {
      text: "Fresh croissants, baked before sunrise",
      look,
      width: 900,
      maxHeight: 400,
      sizes: ladder,
      floor: 20,
    });
    expect(ladder).toContain(fitted.fontSize);
  });

  it("caps at the largest size when the text is short", async () => {
    const fitted = await fitText(monospaceMeasurer(), {
      text: "Hi",
      look,
      width: 1000,
      maxHeight: 1000,
      sizes: sizeRange(10, 120),
      floor: 10,
    });
    expect(fitted.fontSize).toBe(120);
  });

  it("prefers fewer lines over a bigger size when maxLines is set", async () => {
    const request = {
      text: "one two three four five six",
      look,
      width: 300,
      maxHeight: 2000,
      sizes: sizeRange(10, 300),
      floor: 10,
    };
    const unlimited = await fitText(monospaceMeasurer(), request);
    const capped = await fitText(monospaceMeasurer(), {
      ...request,
      maxLines: 2,
    });
    expect(capped.lines).toBeLessThanOrEqual(2);
    expect(unlimited.lines).toBeGreaterThan(2);
    expect(capped.fontSize).toBeLessThan(unlimited.fontSize);
  });

  it("falls back to more lines rather than failing", async () => {
    const fitted = await fitText(monospaceMeasurer(), {
      text: "one two three four five six seven eight",
      look,
      width: 100,
      maxHeight: 400,
      sizes: sizeRange(20, 100),
      floor: 10,
      maxLines: 1,
    });
    expect(fitted.fits).toBe(true);
    expect(fitted.lines).toBeGreaterThan(1);
  });

  it("never lets a word run past the measured width", async () => {
    const fitted = await fitText(monospaceMeasurer(), {
      text: "Supercalifragilistic",
      look,
      width: 204,
      maxHeight: 1000,
      sizes: sizeRange(10, 100),
      floor: 10,
    });
    // 20 characters at 0.5em inside wrapWidth(204) = 199px: 19px type.
    expect(fitted.fontSize).toBe(19);
    expect(fitted.breaksWords).toBe(false);
  });

  it("goes below the smallest size, toward the floor, for a word that cannot fit", async () => {
    const fitted = await fitText(monospaceMeasurer(), {
      text: "Supercalifragilistic",
      look,
      width: 204,
      maxHeight: 1000,
      sizes: sizeRange(30, 100),
      floor: 12,
    });
    expect(fitted.fits).toBe(true);
    expect(fitted.fontSize).toBe(19);
    expect(fitted.breaksWords).toBe(false);
  });

  /* B9 and B10 together: below the floor the word breaks instead of the type
     shrinking to 4px (B9) or the word running off the box (B10). */
  it("breaks a word at the floor rather than shrinking past it", async () => {
    const measurer = monospaceMeasurer();
    const text = "Pneumonoultramicroscopicsilicovolcanoconiosis";
    const fitted = await fitText(measurer, {
      text,
      look,
      width: 200,
      maxHeight: 1000,
      sizes: sizeRange(30, 100),
      floor: 16,
    });
    expect(fitted.fontSize).toBe(16);
    expect(fitted.breaksWords).toBe(true);
    expect(fitted.fits).toBe(true);
    /* The break shows in the measured height: more than one line. */
    expect(fitted.lines).toBeGreaterThan(1);
  });

  it("reports a broken word that also overruns the box as not fitting", async () => {
    const fitted = await fitText(monospaceMeasurer(), {
      text: "Pneumonoultramicroscopicsilicovolcanoconiosis",
      look,
      width: 200,
      maxHeight: 20,
      sizes: sizeRange(30, 100),
      floor: 16,
    });
    expect(fitted.breaksWords).toBe(true);
    expect(fitted.fits).toBe(false);
  });

  it("reports a misfit at the smallest size instead of overflowing silently", async () => {
    const fitted = await fitText(monospaceMeasurer(), {
      text: "a b c d e f g h i j k l m n o p",
      look,
      width: 40,
      maxHeight: 30,
      sizes: sizeRange(20, 100),
      floor: 10,
    });
    expect(fitted.fits).toBe(false);
    expect(fitted.fontSize).toBe(20);
  });

  it("judges the floor alone when every size was filtered away", async () => {
    const fitted = await fitText(monospaceMeasurer(), {
      text: "Hi",
      look,
      width: 100,
      maxHeight: 100,
      sizes: [],
      floor: 18,
    });
    expect(fitted.fontSize).toBe(18);
    expect(fitted.fits).toBe(true);
  });

  it("is deterministic", async () => {
    const request = {
      text: "Fresh croissants, baked before sunrise",
      look,
      width: 500,
      maxHeight: 300,
      sizes: sizeRange(12, 160),
      floor: 12,
      maxLines: 3,
    };
    const a = await fitText(monospaceMeasurer(), request);
    const b = await fitText(monospaceMeasurer(), request);
    expect(a).toEqual(b);
  });
});

describe("balancedWidth", () => {
  const text = "one two three four five six seven";

  it("narrows a run to even lines without adding a line", async () => {
    const measurer = monospaceMeasurer();
    const width = 400;
    const size = 20;
    const fitted = await fitText(measurer, {
      text,
      look,
      width,
      maxHeight: 1000,
      sizes: [size],
      floor: 10,
    });
    const drawn = await balancedWidth(
      measurer,
      text,
      look(size),
      width,
      fitted,
    );
    expect(drawn).toBeLessThan(width);
    /* Drawn at the balanced width, the run keeps its fitted lines... */
    expect(await measurer.height(text, look(size), drawn)).toBe(fitted.height);
    /* ...and so it does in a browser that shapes a word up to the slack
       wider: at the balanced width less the slack it still fits. */
    expect(
      await measurer.height(text, look(size), drawn - wrapSlack(width)),
    ).toBe(fitted.height);
  });

  it("never draws fewer lines than the box was sized for", async () => {
    const measurer = monospaceMeasurer();
    for (const width of [120, 157, 203, 260, 333, 401]) {
      const fitted = await fitText(measurer, {
        text,
        look,
        width,
        maxHeight: 1000,
        sizes: [20],
        floor: 10,
      });
      const drawn = await balancedWidth(
        measurer,
        text,
        look(20),
        width,
        fitted,
      );
      expect(drawn).toBeLessThanOrEqual(width);
      expect(await measurer.height(text, look(20), drawn), `${width}`).toBe(
        fitted.height,
      );
    }
  });

  it("keeps a run whose words had to break at the full width", async () => {
    const measurer = monospaceMeasurer();
    const drawn = await balancedWidth(
      measurer,
      "Pneumonoultramicroscopicsilicovolcanoconiosis",
      look(16),
      200,
      { height: 48, breaksWords: true },
    );
    expect(drawn).toBe(200);
  });
});

/* A headline that ends on one word reads as a mistake ("Now In A / Bottle";
   U3 live critique). The monospace measurer sets 10px per character at 20px
   type, so line breaks can be worked out by hand. */
describe("orphans", () => {
  const text = "Fresh bread baked today in Lagos";
  const twenty = look(20);

  it("sees a last word alone on its line", async () => {
    const measurer = monospaceMeasurer();
    expect(await hasOrphan(measurer, text, twenty, 260)).toBe(true);
    expect(await hasOrphan(measurer, text, twenty, 130)).toBe(false);
    expect(await hasOrphan(measurer, text, twenty, 1000)).toBe(false);
    expect(await hasOrphan(measurer, "Two words", twenty, 50)).toBe(false);
  });

  it("finds a width one line taller that ends on two words", async () => {
    const measurer = monospaceMeasurer();
    const fixed = await widthWithoutOrphan(
      measurer,
      text,
      twenty,
      260,
      { height: 40, lines: 2 },
      { maxHeight: 200, maxLines: 4, box: 260 },
    );
    expect(fixed?.lines).toBe(3);
    expect(fixed?.height).toBe(60);
    const width = fixed?.width ?? 0;
    expect(await hasOrphan(measurer, text, twenty, width)).toBe(false);
    /* Narrowed by the wrap slack Chromium needs, it still breaks the same. */
    expect(await measurer.height(text, twenty, width - wrapSlack(260))).toBe(
      60,
    );
  });

  it("keeps the orphan rather than break the line or height limits", async () => {
    const measurer = monospaceMeasurer();
    const limits = { maxHeight: 200, maxLines: 2, box: 260 };
    expect(
      await widthWithoutOrphan(
        measurer,
        text,
        twenty,
        260,
        { height: 40, lines: 2 },
        limits,
      ),
    ).toBeNull();
    expect(
      await widthWithoutOrphan(
        measurer,
        text,
        twenty,
        260,
        { height: 40, lines: 2 },
        { ...limits, maxLines: 3, maxHeight: 50 },
      ),
    ).toBeNull();
  });

  it("leaves a run without an orphan alone", async () => {
    expect(
      await widthWithoutOrphan(
        monospaceMeasurer(),
        text,
        twenty,
        130,
        { height: 60, lines: 3 },
        { maxHeight: 200, maxLines: 4, box: 130 },
      ),
    ).toBeNull();
  });
});

describe("inkOverhang", () => {
  it("is glyphOverhang when the measurer cannot see ink", async () => {
    const floor = glyphOverhang(look(100));
    expect(await inkOverhang(monospaceMeasurer(), "Ẫ", look(100))).toEqual({
      above: floor,
      below: floor,
    });
  });

  it("covers the measured reach of stacked marks, one pixel past it", async () => {
    const measurer = {
      ...monospaceMeasurer(),
      inkExtent: async () => ({ above: 17.2, below: 0 }),
    };
    const extent = await inkOverhang(measurer, "Ẫ", look(100));
    expect(extent.above).toBe(19);
    expect(extent.below).toBe(glyphOverhang(look(100)));
  });
});
