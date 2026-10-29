// @vitest-environment node
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import type { DesignSpec } from "@/lib/design/spec";
import type { ImageFacts, ImagePlacement } from "./builders/ground";
import { monospaceMeasurer, specFor } from "./fixtures";
import { documentFromSpec } from "./from-spec";
import { measureImage } from "./image-facts";
import type { ImageElement } from "./schema";
import {
  coverPlacement,
  cutsAHead,
  HEAD_MARGIN_X,
  HEAD_MARGIN_Y,
  headsWithMargin,
  type SubjectBox,
  subjectOnCanvas,
} from "./subject";

/*
 * Round-26 contract break: round 25's live cafe split-left cut the
 * barista's face at the photo's right edge. The look boxed her head at
 * x 0.66 to 0.90 of the photo; the frame ended at 0.901; her face runs to
 * 0.946. cutsAHead took the box as exact and passed the crop. Heads now
 * enter the layouts grown by the head margin.
 */

/* busy-cafe-espresso.jpg, the stock photo the live run drew. */
const STOCK_CAFE = { width: 5242, height: 3744 };

/* The round-25 live look (usage row 2026-10-29 17:22:39 UTC, cafe brand
   9930f0c3), exactly as stored. */
const R25_LOOK: { subject: SubjectBox; heads: SubjectBox[] } = {
  subject: { x: 0.16, y: 0.26, w: 0.66, h: 0.64 },
  heads: [
    { x: 0.5599999999999999, y: 0.16, w: 0.22000000000000008, h: 0.28 },
    {
      x: 0.66,
      y: 0.09999999999999999,
      w: 0.24,
      h: 0.30000000000000004,
    },
  ],
};

/* The delivered slot-0 split-left's image element
   (critique-25/live/cafe-photo-slot0-split-left.document.json). */
const R25_SPLIT_LEFT: ImagePlacement = {
  frame: { x: 562, y: 259, width: 475, height: 432 },
  fit: "cover",
  zoom: 1,
  focusX: 0.54,
  focusY: 0,
};

/* The two heads as they are in the photo, marked by hand on a 1% grid
   (critique-26/cafe-heads-grid.png, head-truth.txt). */
const TRUE_HEADS: SubjectBox[] = [
  { x: 0.545, y: 0.375, w: 0.075, h: 0.105 },
  { x: 0.835, y: 0.375, w: 0.11, h: 0.195 },
];

const contains = (outer: SubjectBox, inner: SubjectBox) =>
  outer.x <= inner.x + 1e-9 &&
  outer.y <= inner.y + 1e-9 &&
  outer.x + outer.w >= inner.x + inner.w - 1e-9 &&
  outer.y + outer.h >= inner.y + inner.h - 1e-9;

describe("round 26: the round-25 live cafe crop", () => {
  it("maps the look's heads where the live trace put them", () => {
    const [man, barista] = R25_LOOK.heads.map((head) =>
      subjectOnCanvas(STOCK_CAFE, head, R25_SPLIT_LEFT),
    );
    /* critique-25/cafe-s0-edge.txt */
    expect(man.x).toBeCloseTo(830.6, 0);
    expect(man.x + man.width).toBeCloseTo(963.7, 0);
    expect(barista.x).toBeCloseTo(891.1, 0);
    expect(barista.x + barista.width).toBeCloseTo(1036.2, 0);
  });

  it("cut the barista's true head, and the look's box alone did not say so", () => {
    expect(cutsAHead(STOCK_CAFE, TRUE_HEADS, R25_SPLIT_LEFT)).toBe(true);
    expect(cutsAHead(STOCK_CAFE, R25_LOOK.heads, R25_SPLIT_LEFT)).toBe(false);
  });

  it("is refused as a cut once the heads carry the margin", () => {
    expect(
      cutsAHead(STOCK_CAFE, headsWithMargin(R25_LOOK.heads), R25_SPLIT_LEFT),
    ).toBe(true);
  });

  it("grows each look box to hold the head it missed", () => {
    const grown = headsWithMargin(R25_LOOK.heads);
    TRUE_HEADS.forEach((truth, i) => {
      expect(contains(grown[i], truth), JSON.stringify(grown[i])).toBe(true);
      expect(contains(R25_LOOK.heads[i], truth)).toBe(false);
    });
  });

  it("finds no cover crop in the live frame that cuts either true head", () => {
    const placed = coverPlacement(
      STOCK_CAFE,
      R25_LOOK.subject,
      R25_SPLIT_LEFT.frame,
      [],
      0,
      headsWithMargin(R25_LOOK.heads),
    );
    if (placed) expect(cutsAHead(STOCK_CAFE, TRUE_HEADS, placed)).toBe(false);
  });
});

describe("round 26: headsWithMargin", () => {
  it("grows a box by its own width across and its own height up and down", () => {
    const [grown] = headsWithMargin([{ x: 0.4, y: 0.4, w: 0.1, h: 0.1 }]);
    expect(grown.x).toBeCloseTo(0.4 - 0.1 * HEAD_MARGIN_X, 9);
    expect(grown.w).toBeCloseTo(0.1 * (1 + 2 * HEAD_MARGIN_X), 9);
    expect(grown.y).toBeCloseTo(0.4 - 0.1 * HEAD_MARGIN_Y, 9);
    expect(grown.h).toBeCloseTo(0.1 * (1 + 2 * HEAD_MARGIN_Y), 9);
  });

  it("is at least the contract's floor: 35% across, 25% up and down", () => {
    expect(HEAD_MARGIN_X).toBeGreaterThanOrEqual(0.35);
    expect(HEAD_MARGIN_Y).toBeGreaterThanOrEqual(0.25);
  });

  it("clamps to the photo", () => {
    for (const grown of headsWithMargin([
      { x: 0, y: 0, w: 0.3, h: 0.3 },
      { x: 0.8, y: 0.75, w: 0.2, h: 0.25 },
      { x: 0, y: 0, w: 1, h: 1 },
    ])) {
      expect(grown.x).toBeGreaterThanOrEqual(0);
      expect(grown.y).toBeGreaterThanOrEqual(0);
      expect(grown.x + grown.w).toBeLessThanOrEqual(1 + 1e-9);
      expect(grown.y + grown.h).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("leaves no heads as none", () => {
    expect(headsWithMargin([])).toEqual([]);
  });
});

describe("round 26: a head at the photo's edge may go on past it", () => {
  const PHOTO = { width: 1400, height: 1000 };
  /* A square frame on a 1.4:1 photo: cover crops 400 px of photo width,
     so focusX 1 puts the photo's right edge on the frame's. */
  const FRAME = { x: 0, y: 0, width: 600, height: 600 };
  const at = (focusX: number): ImagePlacement => ({
    frame: FRAME,
    fit: "cover",
    zoom: 1,
    focusX,
    focusY: 0.5,
  });
  /* A barista at the right edge: the look's box touches it. */
  const touching = headsWithMargin([{ x: 0.86, y: 0.3, w: 0.14, h: 0.2 }]);
  /* Short of it by less than the margin: she may still run past it. */
  const near = headsWithMargin([{ x: 0.82, y: 0.3, w: 0.14, h: 0.2 }]);

  it("keeps the grown box on the edge it touched", () => {
    for (const [head] of [touching, near]) {
      expect(head.x + head.w).toBeCloseTo(1, 9);
    }
  });

  it("is shown only with the photo's edge as the frame's edge", () => {
    for (const heads of [touching, near]) {
      expect(cutsAHead(PHOTO, heads, at(1))).toBe(false);
      for (const focusX of [0.9, 0.95, 0.98, 0.99]) {
        expect(cutsAHead(PHOTO, heads, at(focusX)), String(focusX)).toBe(true);
      }
    }
  });

  it("may be cropped out whole, never cropped into", () => {
    expect(cutsAHead(PHOTO, touching, at(0))).toBe(false);
    const placed = coverPlacement(
      PHOTO,
      { x: 0.3, y: 0.4, w: 0.3, h: 0.4 },
      FRAME,
      [],
      0,
      touching,
    );
    expect(placed).not.toBeNull();
    expect(cutsAHead(PHOTO, touching, placed as ImagePlacement)).toBe(false);
  });

  it("on the top and left edges as on the right", () => {
    const corner = headsWithMargin([{ x: 0, y: 0.02, w: 0.12, h: 0.16 }]);
    expect(corner[0].x).toBe(0);
    expect(corner[0].y).toBe(0);
    expect(cutsAHead(PHOTO, corner, at(0))).toBe(false);
    expect(cutsAHead(PHOTO, corner, at(0.05))).toBe(true);
    const tall = { x: 0, y: 0, width: 600, height: 300 };
    const top = (focusY: number): ImagePlacement => ({
      frame: tall,
      fit: "cover",
      zoom: 1,
      focusX: 0,
      focusY,
    });
    expect(cutsAHead(PHOTO, corner, top(0))).toBe(false);
    expect(cutsAHead(PHOTO, corner, top(0.03))).toBe(true);
  });
});

describe("round 26: no photo layout cuts a head of the round-25 look", () => {
  let facts: ImageFacts;
  beforeAll(async () => {
    const bytes = await sharp({
      create: { ...STOCK_CAFE, channels: 3, background: "#6b625a" },
    })
      .jpeg()
      .toBuffer();
    const measured = await measureImage({
      bytes: new Uint8Array(bytes),
      contentType: "image/jpeg",
    });
    if (!measured) throw new Error("photo did not measure");
    facts = measured;
  }, 60_000);
  const COPY: Pick<
    DesignSpec,
    "headline" | "subheadline" | "cta" | "footerStyle" | "footerLines"
  > = {
    headline: "The Cold Brew Flight",
    subheadline:
      "Choose three 150ml tasters for ₦6,000, or a 1-litre bottle and two glasses for ₦15,500.",
    cta: "Come in",
    footerStyle: "text",
    footerLines: ["Weekdays 8am to 6pm", "The bar, 9 Akinola Street, Yaba"],
  };
  const LAYOUTS = [
    "split-left",
    "banner-bottom",
    "hero-center",
    "quote-card",
    "stat-highlight",
  ] as const;
  const ASPECTS = ["1:1", "4:5", "9:16", "16:9"] as const;

  it.each(
    LAYOUTS.flatMap((layout) => ASPECTS.map((a) => [layout, a] as const)),
  )("%s at %s", async (layout, aspect) => {
    const spec = {
      ...specFor(layout, aspect, COPY),
      logoPlacement: "none" as const,
    };
    const heads = headsWithMargin(R25_LOOK.heads);
    const { document } = await documentFromSpec({
      spec,
      palette: spec.palette as never,
      canvas: canvasFor(aspect),
      image: { key: "design-images/b1/round26-cafe.jpg" },
      imageFacts: facts,
      subject: R25_LOOK.subject,
      heads,
      logo: null,
      measurer: monospaceMeasurer(),
    });
    const image = document.elements.find(
      (e): e is ImageElement => e.type === "image" && !e.hidden,
    );
    if (!image) return;
    const placement: ImagePlacement = {
      frame: {
        x: image.x,
        y: image.y,
        width: image.width,
        height: image.height,
      },
      fit: image.fit,
      ...image.crop,
    };
    expect(cutsAHead(facts, heads, placement)).toBe(false);
    expect(cutsAHead(facts, TRUE_HEADS, placement)).toBe(false);
  });
});
