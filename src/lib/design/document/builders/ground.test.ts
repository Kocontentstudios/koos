import { describe, expect, it } from "vitest";
import {
  bestVeil,
  COPY_CONTRAST,
  drawnImageRect,
  groundSamples,
  type ImageFacts,
  type Rgb,
  UNKNOWN_GROUND,
  veilAlpha,
  veilColor,
} from "./ground";

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const MID: Rgb = [128, 128, 128];
const BROWN = "#3B2416";

function luminance([r, g, b]: Rgb): number {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
const ratio = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** The contrast copy actually gets once `alpha` of `veil` is laid over it. */
function contrastUnder(sample: Rgb, veil: Rgb, alpha: number, text: Rgb) {
  const seen = sample.map((c, i) => c + (veil[i] - c) * alpha) as Rgb;
  return ratio(luminance(seen), luminance(text));
}

describe("veilAlpha", () => {
  it("needs no veil where the copy already reads", () => {
    expect(veilAlpha([BLACK], "#FFFFFF")).toEqual({
      color: "#000000",
      alpha: 0,
    });
    expect(veilAlpha([WHITE], BROWN)?.alpha).toBe(0);
  });

  it("finds the least veil that clears the target, and no less", () => {
    const needed = veilAlpha([WHITE, MID], "#FFFFFF");
    if (!needed) throw new Error("white copy over a black veil always clears");
    expect(
      contrastUnder(WHITE, BLACK, needed.alpha, WHITE),
    ).toBeGreaterThanOrEqual(COPY_CONTRAST);
    expect(
      contrastUnder(WHITE, BLACK, needed.alpha - 0.01, WHITE),
    ).toBeLessThan(COPY_CONTRAST);
  });

  it("puts a light veil under dark copy", () => {
    const needed = veilAlpha([BLACK], BROWN);
    expect(needed?.color).toBe("#FFFFFF");
    expect(needed?.alpha).toBeGreaterThan(0.5);
  });

  it("says when not even a full veil would do", () => {
    /* Mid grey copy: neither a black nor a white ground gives it 4.6:1. */
    expect(veilAlpha([BLACK], "#767676")).toBeNull();
  });
});

describe("bestVeil", () => {
  const candidates = ["#FFFFFF", BROWN, "#111111"];

  /* Visual verdict, round 1: a fixed 0.62 scrim turned a white photo flat
     grey. Measured, a white photo needs dark copy and no veil at all. */
  it("sets dark copy with no veil on a bright photo", () => {
    expect(bestVeil([WHITE, [245, 243, 240]], candidates)).toEqual({
      text: BROWN,
      color: "#FFFFFF",
      alpha: 0,
    });
  });

  it("sets white copy with no veil on a dark photo", () => {
    expect(bestVeil([BLACK, [30, 20, 15]], candidates)).toEqual({
      text: "#FFFFFF",
      color: "#000000",
      alpha: 0,
    });
  });

  it("keeps a busy photo deep: white copy over a black veil", () => {
    const veil = bestVeil([WHITE, BLACK, MID], candidates);
    expect(veil.text).toBe("#FFFFFF");
    expect(veil.color).toBe("#000000");
    for (const sample of [WHITE, BLACK, MID]) {
      expect(
        contrastUnder(sample, BLACK, veil.alpha, WHITE),
      ).toBeGreaterThanOrEqual(COPY_CONTRAST);
    }
  });

  it("treats an unmeasured photo as the worst case, as the fixed scrim did", () => {
    const veil = bestVeil(UNKNOWN_GROUND, candidates);
    expect(veil.text).toBe("#FFFFFF");
    expect(veil.alpha).toBeGreaterThanOrEqual(0.5);
  });

  it("prefers the brand's own dark over a neutral that costs the same", () => {
    expect(bestVeil([WHITE], candidates).text).toBe(BROWN);
  });
});

describe("veilColor", () => {
  it("writes an rgba() the schema's colour grammar accepts", () => {
    expect(veilColor({ color: "#000000" }, 0.537)).toBe("rgba(0,0,0,0.54)");
    expect(veilColor({ color: "#FFF4E6" }, 1)).toBe("rgba(255,244,230,1)");
  });
});

const FACTS: ImageFacts = {
  width: 200,
  height: 100,
  cutout: false,
  ink: { left: 0, top: 0, right: 1, bottom: 1 },
  /* Left half black, right half white, two cells. */
  grid: { cols: 2, rows: 1, rgba: [0, 0, 0, 255, 255, 255, 255, 255] },
};

describe("drawnImageRect", () => {
  it("covers a frame, cropping the long side evenly", () => {
    expect(
      drawnImageRect(FACTS, {
        frame: { x: 0, y: 0, width: 100, height: 100 },
        fit: "cover",
        zoom: 1,
        focusX: 0.5,
        focusY: 0.5,
      }),
    ).toEqual({ x: -50, y: 0, width: 200, height: 100 });
  });

  it("contains an image, letterboxing the short side", () => {
    expect(
      drawnImageRect(FACTS, {
        frame: { x: 10, y: 10, width: 100, height: 100 },
        fit: "contain",
        zoom: 1,
        focusX: 0.5,
        focusY: 0.5,
      }),
    ).toEqual({ x: 10, y: 35, width: 100, height: 50 });
  });
});

describe("groundSamples", () => {
  const placement = {
    frame: { x: 0, y: 0, width: 200, height: 100 },
    fit: "cover" as const,
    zoom: 1,
    focusX: 0.5,
    focusY: 0.5,
  };

  it("reads the image under the region it is asked about", () => {
    const left = groundSamples(
      FACTS,
      placement,
      { x: 10, y: 10, width: 60, height: 60 },
      "#FF0000",
    );
    expect(left.every((s) => s.every((c) => c === 0))).toBe(true);
    const right = groundSamples(
      FACTS,
      placement,
      { x: 130, y: 10, width: 60, height: 60 },
      "#FF0000",
    );
    expect(right.every((s) => s.every((c) => c === 255))).toBe(true);
  });

  it("reads the canvas background through transparent pixels and outside the frame", () => {
    const clear: ImageFacts = {
      ...FACTS,
      grid: { cols: 1, rows: 1, rgba: [0, 0, 0, 0] },
    };
    const samples = groundSamples(
      clear,
      placement,
      { x: 0, y: 0, width: 300, height: 100 },
      "#FF0000",
    );
    expect(samples.every(([r, g, b]) => r === 255 && g === 0 && b === 0)).toBe(
      true,
    );
  });
});
