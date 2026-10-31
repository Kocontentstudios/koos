import { describe, expect, it } from "vitest";
import { alphaAt, atLeast, startClear } from "./builders/scrim";
import type { DesignDocument, DesignElement } from "./schema";
import {
  BAND_COVER_MAX,
  bandCover,
  bandedPlacement,
  intersection,
  measureSubject,
  subjectOnCanvas,
} from "./subject";

/*
 * Oluwaseyi's ruling of 2026-10-29: over a full-bleed photo the copy band
 * may lie on the outer edge of the subject box, under a dark veil, never
 * on a face or head box and never on more than a quarter of the box's
 * width (side band) or height (top or bottom band).
 */

const base = { rotation: 0, opacity: 1, hidden: false, locked: false };
const IMAGE = { width: 1080, height: 1350 };
const CANVAS = { x: 0, y: 0, width: 1080, height: 1350 };
/* At zoom 1 the image is the canvas: the box below is x 216..864. */
const SUBJECT = { x: 0.2, y: 0.1, w: 0.6, h: 0.8 };
const HEAD = { x: 0.24, y: 0.12, w: 0.08, h: 0.08 };

const image: DesignElement = {
  ...base,
  id: "image",
  name: "Image",
  type: "image",
  ...CANVAS,
  asset: { key: "design-images/b1/photo.jpg" },
  fit: "cover",
  crop: { zoom: 1, focusX: 0.5, focusY: 0.5 },
  radius: 0,
};
const veil = (width: number, colour = "0,0,0"): DesignElement => ({
  ...base,
  id: "scrim",
  name: "Scrim",
  type: "shape",
  x: 0,
  y: 0,
  width,
  height: 1350,
  fill: `linear-gradient(270deg, rgba(${colour},0) 0%, rgba(${colour},0.8) 40%, rgba(${colour},1) 100%)`,
  borderColor: "transparent",
  borderWidth: 0,
  radius: 0,
});
const text = (id: string, x: number, y: number, width: number) =>
  ({
    ...base,
    id,
    name: id,
    type: "text",
    x,
    y,
    width,
    height: 60,
    text: "Copy",
    role: "headline",
    fontFamily: "heading",
    fontSize: 48,
    fontWeight: 700,
    color: "#FFFFFF",
    align: "left",
    lineHeight: 1.1,
    letterSpacing: 0,
  }) as unknown as DesignElement;
const doc = (...elements: DesignElement[]): DesignDocument => ({
  version: 1,
  width: 1080,
  height: 1350,
  background: "#FFFFFF",
  elements: [image, ...elements],
});

describe("round 24: copy on the subject's outer edge under a dark veil", () => {
  /* The outer quarter of the box runs 216..366. */
  it("allows a headline in the outer quarter, under the dark veil, off every head", () => {
    const report = measureSubject(
      doc(veil(380), text("headline", 60, 700, 300)),
      IMAGE,
      SUBJECT,
      [HEAD],
    );
    expect(report?.overlaps).toEqual([]);
    expect(report?.veiled.map((o) => o.id)).toEqual(["headline"]);
    expect(report?.ok).toBe(true);
  });

  it("refuses copy reaching past a quarter of the box", () => {
    const report = measureSubject(
      doc(veil(500), text("headline", 60, 700, 400)),
      IMAGE,
      SUBJECT,
      [HEAD],
    );
    expect(report?.overlaps.map((o) => o.id)).toEqual(["headline"]);
  });

  it("refuses copy on a head, however far out it sits", () => {
    const report = measureSubject(
      doc(veil(380), text("headline", 60, 160, 300)),
      IMAGE,
      SUBJECT,
      [HEAD],
    );
    expect(report?.overlaps.map((o) => o.id)).toEqual(["headline"]);
  });

  it("refuses copy under a light veil, or under no veil", () => {
    for (const elements of [
      [veil(380, "255,255,255"), text("headline", 60, 700, 300)],
      [text("headline", 60, 700, 300)],
    ]) {
      expect(
        measureSubject(doc(...elements), IMAGE, SUBJECT, [HEAD])?.overlaps.map(
          (o) => o.id,
        ),
      ).toEqual(["headline"]);
    }
  });

  it("refuses copy outside the veil's box", () => {
    const report = measureSubject(
      doc(veil(200), text("headline", 60, 700, 300)),
      IMAGE,
      SUBJECT,
      [HEAD],
    );
    expect(report?.overlaps.map((o) => o.id)).toEqual(["headline"]);
  });
});

describe("round 24: bandedPlacement", () => {
  const gap = 22;
  const options = {
    heads: [] as (typeof HEAD)[],
    avoid: [],
    minEdge: 378,
    gap,
  };
  const wide = { width: 1600, height: 1350 };
  /* 640 px across at zoom 1, beside a band 497 px wide on a 1080 canvas. */
  const NARROW = { x: 0.3, y: 0.1, w: 0.4, h: 0.8 };

  it("puts the band on no more than a quarter of the subject", () => {
    const band = { x: 0, y: 0, width: 497, height: 1350 };
    const found = bandedPlacement(wide, NARROW, CANVAS, band, "left", options);
    expect(found).not.toBeNull();
    const box = subjectOnCanvas(
      wide,
      NARROW,
      found?.placement as NonNullable<typeof found>["placement"],
    );
    expect(bandCover(box, band, "left")).toBeLessThanOrEqual(BAND_COVER_MAX);
    expect(found?.cover).toBeCloseTo(bandCover(box, band, "left"), 6);
  });

  it("keeps every head the gap clear of the band", () => {
    const band = { x: 0, y: 0, width: 497, height: 1350 };
    const head = { x: 0.4, y: 0.2, w: 0.06, h: 0.1 };
    const found = bandedPlacement(wide, NARROW, CANVAS, band, "left", {
      ...options,
      heads: [head],
    });
    expect(found).not.toBeNull();
    if (found) {
      const onCanvas = subjectOnCanvas(wide, head, found.placement);
      expect(
        intersection(onCanvas, {
          x: band.x - gap,
          y: band.y - gap,
          width: band.width + gap * 2,
          height: band.height + gap * 2,
        }),
      ).toBeNull();
    }
  });

  it("finds nothing when the open side cannot hold three quarters of the subject", () => {
    const band = { x: 0, y: 0, width: 900, height: 1350 };
    expect(
      bandedPlacement(wide, SUBJECT, CANVAS, band, "left", options),
    ).toBeNull();
  });
});

describe("round 24: a veil that starts from nothing", () => {
  it("rises from zero at the clear edge to what it held at the nearest copy", () => {
    const stops = [
      { at: 0, alpha: 0.41 },
      { at: 0.06, alpha: 0.6 },
      { at: 0.1, alpha: 1 },
      { at: 1, alpha: 1 },
    ];
    const clear = startClear(stops, 0.06);
    expect(clear[0]).toEqual({ at: 0, alpha: 0 });
    for (const u of [0.06, 0.08, 0.1, 0.5, 1]) {
      expect(alphaAt(clear, u)).toBeGreaterThanOrEqual(
        alphaAt(stops, u) - 1e-9,
      );
    }
  });

  it("never lets a floor's merge raise the clear edge", () => {
    const merged = atLeast(
      [
        { at: 0, alpha: 0 },
        { at: 0.02, alpha: 0.3 },
        { at: 0.05, alpha: 0.5 },
        { at: 0.3, alpha: 0.6 },
        { at: 1, alpha: 0.6 },
      ],
      [
        { at: 0, alpha: 0 },
        { at: 0.4, alpha: 1 },
        { at: 1, alpha: 1 },
      ],
    );
    expect(merged.length).toBeLessThanOrEqual(5);
    expect(merged[0]).toEqual({ at: 0, alpha: 0 });
  });
});
