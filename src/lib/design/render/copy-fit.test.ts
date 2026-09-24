import { describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import {
  BANNER_BAND,
  bannerBandFor,
  copySpaceFor,
  estimateCopyHeight,
  estimateLines,
  fitHeadlineSize,
  HEADLINE_STEPS,
} from "@/lib/design/render/copy-fit";

const spec = {
  headline: "Lagos Launch Week",
  subheadline: "Free delivery for the first three days",
  cta: "Order now",
};

describe("estimateLines", () => {
  it("keeps short text on one line", () => {
    expect(estimateLines("Autumn", 100, 2000, 0.58)).toBe(1);
  });

  /* Words, not characters. "Lagos Launch Week" at a size fitting ~16
     characters wraps after "Launch", not mid-word — a naive length/perLine
     undercounts by a line exactly when the headline is short enough to take
     the biggest step, which is the case that broke. */
  it("wraps on word boundaries", () => {
    // Room for about 12 characters at this size.
    expect(estimateLines("Lagos Launch Week", 100, 700, 0.58)).toBe(2);
  });

  it("breaks a single word that cannot fit a line", () => {
    expect(
      estimateLines("Supercalifragilistic", 100, 300, 0.58),
    ).toBeGreaterThan(1);
  });

  it("never reports less than one line", () => {
    expect(estimateLines("", 100, 1000, 0.58)).toBe(1);
    expect(estimateLines("hi", 0, 1000, 0.58)).toBe(1);
    expect(estimateLines("hi", 100, 0, 0.58)).toBe(1);
  });

  it("needs more lines as the size grows", () => {
    const small = estimateLines(spec.subheadline, 30, 800, 0.52);
    const large = estimateLines(spec.subheadline, 60, 800, 0.52);
    expect(large).toBeGreaterThanOrEqual(small);
  });
});

describe("copySpaceFor", () => {
  const canvas = canvasFor("4:5");

  /* Read off the layout bodies: the copy does not get the whole canvas in
     three of the five. */
  it("gives banner-bottom only its band", () => {
    const band = copySpaceFor("banner-bottom", canvas);
    expect(band.height).toBeLessThan(canvas.height * 0.38);
    expect(band.height).toBeLessThan(
      copySpaceFor("hero-center", canvas).height,
    );
  });

  it("gives split-left only its column", () => {
    expect(copySpaceFor("split-left", canvas).width).toBeLessThan(
      canvas.width * 0.52,
    );
  });

  it("accounts for the card layouts padding twice", () => {
    expect(copySpaceFor("quote-card", canvas).height).toBeLessThan(
      copySpaceFor("hero-center", canvas).height,
    );
  });

  it("never returns a negative box", () => {
    for (const layout of [
      "hero-center",
      "split-left",
      "banner-bottom",
      "quote-card",
      "stat-highlight",
    ] as const) {
      for (const ratio of ["1:1", "4:5", "9:16", "16:9"] as const) {
        const space = copySpaceFor(layout, canvasFor(ratio));
        expect(space.width).toBeGreaterThan(0);
        expect(space.height).toBeGreaterThan(0);
      }
    }
  });
});

describe("fitHeadlineSize", () => {
  /* The bug: the same words got the same size in hero-center, which has the
     whole canvas, and in banner-bottom, which has a third of it. */
  it("gives a tight band a smaller headline than a full canvas", () => {
    const canvas = canvasFor("4:5");
    expect(
      fitHeadlineSize({ spec, layout: "banner-bottom", canvas }),
    ).toBeLessThan(fitHeadlineSize({ spec, layout: "hero-center", canvas }));
  });

  it("always returns a size from the ladder", () => {
    const canvas = canvasFor("4:5");
    const reference = Math.min(canvas.width, canvas.height);
    const sizes = HEADLINE_STEPS.map((s) => reference * s);
    for (const layout of [
      "hero-center",
      "banner-bottom",
      "quote-card",
    ] as const) {
      expect(sizes).toContain(fitHeadlineSize({ spec, layout, canvas }));
    }
  });

  /* The whole point: whatever it picks, the stack has to fit. */
  it.each([
    ["hero-center", "4:5"],
    ["banner-bottom", "4:5"],
    ["banner-bottom", "16:9"],
    ["split-left", "16:9"],
    ["quote-card", "9:16"],
    ["stat-highlight", "1:1"],
  ] as const)("fits the copy in %s at %s", (layout, ratio) => {
    const canvas = canvasFor(ratio);
    // Every size keys off the shorter side, like the padding does.
    const reference = Math.min(canvas.width, canvas.height);
    const space = copySpaceFor(
      layout,
      canvas,
      layout === "banner-bottom" ? BANNER_BAND.max : undefined,
    );
    for (const headline of [
      "Autumn",
      "Lagos Launch Week",
      "Lagos Launch Week Is Finally Here And Everyone Is Invited To Come",
    ]) {
      const candidate = { ...spec, headline };
      const bannerBand =
        layout === "banner-bottom" ? BANNER_BAND.max : undefined;
      const headlineSize = fitHeadlineSize({
        spec: candidate,
        layout,
        canvas,
        bannerBand,
      });
      const needed = estimateCopyHeight({
        spec: candidate,
        headlineSize,
        width: reference,
        maxWidth: space.width,
      });
      // Only the smallest step is allowed to overflow, and only for copy that
      // cannot fit at any size.
      if (headlineSize > reference * HEADLINE_STEPS.at(-1)!) {
        expect(needed).toBeLessThanOrEqual(space.height);
      }
    }
  });

  it("takes the largest step it can for short copy on a big canvas", () => {
    const canvas = canvasFor("9:16");
    expect(
      fitHeadlineSize({
        spec: { headline: "Sale", subheadline: undefined, cta: undefined },
        layout: "hero-center",
        canvas,
      }),
    ).toBe(Math.min(canvas.width, canvas.height) * HEADLINE_STEPS[0]);
  });
});

describe("estimateCopyHeight", () => {
  const canvas = canvasFor("4:5");

  it("grows with each block the stack carries", () => {
    const base = { headline: "Launch" };
    const sizes = [
      estimateCopyHeight({
        spec: base,
        headlineSize: 100,
        width: canvas.width,
        maxWidth: 900,
      }),
      estimateCopyHeight({
        spec: { ...base, subheadline: spec.subheadline },
        headlineSize: 100,
        width: canvas.width,
        maxWidth: 900,
      }),
      estimateCopyHeight({
        spec: { ...base, subheadline: spec.subheadline, cta: spec.cta },
        headlineSize: 100,
        width: canvas.width,
        maxWidth: 900,
      }),
    ];
    expect(sizes[0]).toBeLessThan(sizes[1]);
    expect(sizes[1]).toBeLessThan(sizes[2]);
  });

  it("grows when the copy has less width to wrap into", () => {
    const wide = estimateCopyHeight({
      spec,
      headlineSize: 100,
      width: canvas.width,
      maxWidth: 1600,
    });
    const narrow = estimateCopyHeight({
      spec,
      headlineSize: 100,
      width: canvas.width,
      maxWidth: 400,
    });
    expect(narrow).toBeGreaterThan(wide);
  });
});

describe("bannerBandFor", () => {
  /* At 16:9 the band was a flat 38% of a 756px canvas — 287px, of which the
     padding took 120. Growing it is what a designer does when the copy does
     not fit the strip they first drew. */
  it("grows the band when the flat 38% cannot hold the copy", () => {
    const landscape = canvasFor("16:9");
    expect(
      bannerBandFor({
        spec: {
          headline: "Lagos Launch Week",
          subheadline: "Free delivery for the first three days",
          cta: "Order now",
        },
        canvas: landscape,
      }),
    ).toBeGreaterThan(BANNER_BAND.min);
  });

  it("leaves the band alone when the copy already fits", () => {
    expect(
      bannerBandFor({
        spec: { headline: "Sale" },
        canvas: canvasFor("9:16"),
      }),
    ).toBe(BANNER_BAND.min);
  });

  it("never takes more than its cap, however long the copy", () => {
    const band = bannerBandFor({
      spec: {
        headline:
          "Lagos Launch Week Is Finally Here And Absolutely Everyone In The City Is Invited To Come Along",
        subheadline:
          "Free delivery for the first three days, on every order, to every address we serve",
        cta: "Order now",
      },
      canvas: canvasFor("16:9"),
    });
    expect(band).toBeLessThanOrEqual(BANNER_BAND.max);
    expect(band).toBeGreaterThanOrEqual(BANNER_BAND.min);
  });

  it("leaves the plate the rest of the canvas", () => {
    for (const ratio of ["1:1", "4:5", "9:16", "16:9"] as const) {
      const band = bannerBandFor({
        spec: { headline: "Lagos Launch Week", cta: "Order now" },
        canvas: canvasFor(ratio),
      });
      expect(1 - band).toBeGreaterThan(0.4);
    }
  });
});
