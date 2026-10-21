import { describe, expect, it } from "vitest";
import {
  fitText,
  glyphOverhang,
  largestFitting,
  lineBox,
  lineCount,
  type TextLook,
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

describe("fitText", () => {
  it("picks the largest size that fits the box", async () => {
    const measurer = monospaceMeasurer();
    const fitted = await fitText(measurer, {
      text: "ab cd ef gh",
      look,
      width: 100,
      maxHeight: 100,
      minSize: 10,
      maxSize: 200,
    });
    expect(fitted.fits).toBe(true);
    expect(fitted.height).toBeLessThanOrEqual(100);
    // One size up must not fit, or the search stopped short.
    expect(
      (await measurer.height("ab cd ef gh", look(fitted.fontSize + 1), 100)) >
        100 ||
        (await measurer.widestWord("ab cd ef gh", look(fitted.fontSize + 1))) >
          100,
    ).toBe(true);
  });

  it("caps at maxSize when the text is short", async () => {
    const fitted = await fitText(monospaceMeasurer(), {
      text: "Hi",
      look,
      width: 1000,
      maxHeight: 1000,
      minSize: 10,
      maxSize: 120,
    });
    expect(fitted.fontSize).toBe(120);
  });

  it("prefers fewer lines over a bigger size when maxLines is set", async () => {
    const request = {
      text: "one two three four five six",
      look,
      width: 300,
      maxHeight: 2000,
      minSize: 10,
      maxSize: 300,
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
      minSize: 20,
      maxSize: 100,
      maxLines: 1,
    });
    expect(fitted.fits).toBe(true);
    expect(fitted.lines).toBeGreaterThan(1);
  });

  it("never lets a word run past the box", async () => {
    const fitted = await fitText(monospaceMeasurer(), {
      text: "Supercalifragilistic",
      look,
      width: 200,
      maxHeight: 1000,
      minSize: 10,
      maxSize: 100,
    });
    // 20 characters at 0.5em must be at most 200px wide: 20px type.
    expect(fitted.fontSize).toBe(20);
    expect(fitted.wordOverflows).toBe(false);
  });

  it("goes below minSize, down to half, for a word that cannot fit", async () => {
    const fitted = await fitText(monospaceMeasurer(), {
      text: "Supercalifragilistic",
      look,
      width: 200,
      maxHeight: 1000,
      minSize: 30,
      maxSize: 100,
    });
    expect(fitted.fits).toBe(true);
    expect(fitted.fontSize).toBe(20);
  });

  it("reports a misfit at the minimum instead of overflowing silently", async () => {
    const fitted = await fitText(monospaceMeasurer(), {
      text: "a b c d e f g h i j k l m n o p",
      look,
      width: 40,
      maxHeight: 30,
      minSize: 20,
      maxSize: 100,
    });
    expect(fitted.fits).toBe(false);
    expect(fitted.fontSize).toBe(20);
  });

  it("is deterministic", async () => {
    const request = {
      text: "Fresh croissants, baked before sunrise",
      look,
      width: 500,
      maxHeight: 300,
      minSize: 12,
      maxSize: 160,
      maxLines: 3,
    };
    const a = await fitText(monospaceMeasurer(), request);
    const b = await fitText(monospaceMeasurer(), request);
    expect(a).toEqual(b);
  });
});
