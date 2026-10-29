// @vitest-environment node
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import type { DesignSpec } from "@/lib/design/spec";
import { drawnImageRect, type ImageFacts } from "./builders/ground";
import { monospaceMeasurer, specFor } from "./fixtures";
import { documentFromSpec } from "./from-spec";
import { measureImage } from "./image-facts";
import type { ImageElement } from "./schema";
import {
  bandedPlacement,
  coverPlacement,
  cutsAHead,
  HEADS_UNKNOWN,
  headsUnknown,
  wholePlacement,
} from "./subject";

/*
 * Round-10 live verdict, CB2: a look of people with no head boxes left
 * cutsAHead nothing to keep whole, and the cafe crop sliced the barista's
 * face. Heads unknown is the whole photo as the head box: no crop, no
 * band on it, and the photo drawn whole.
 */

const PHOTO = { width: 1400, height: 1000 };
/* The 16:14:41 UTC cafe look: two people, photoHeads []. */
const CAFE_SUBJECT = { x: 0.16, y: 0.26, w: 0.68, h: 0.58 };
const SQUARE = { x: 0, y: 0, width: 600, height: 600 };

const crops = (placement: Parameters<typeof drawnImageRect>[1]) => {
  const drawn = drawnImageRect(PHOTO, placement);
  const { frame } = placement;
  return (
    drawn.x < frame.x - 0.5 ||
    drawn.y < frame.y - 0.5 ||
    drawn.x + drawn.width > frame.x + frame.width + 0.5 ||
    drawn.y + drawn.height > frame.y + frame.height + 0.5
  );
};

describe("round 25, CB2: heads unknown", () => {
  it("is the whole photo, and only that reads as unknown", () => {
    expect(headsUnknown(HEADS_UNKNOWN)).toBe(true);
    expect(headsUnknown([])).toBe(false);
    expect(headsUnknown([{ x: 0.6, y: 0.1, w: 0.2, h: 0.3 }])).toBe(false);
  });

  it("makes every crop a cut, and the whole photo none", () => {
    const cropped = {
      frame: SQUARE,
      fit: "cover" as const,
      zoom: 1,
      focusX: 0.5,
      focusY: 0.5,
    };
    expect(cutsAHead(PHOTO, [], cropped)).toBe(false);
    expect(cutsAHead(PHOTO, HEADS_UNKNOWN, cropped)).toBe(true);
    expect(
      cutsAHead(PHOTO, HEADS_UNKNOWN, { ...cropped, fit: "contain" }),
    ).toBe(false);
  });

  it("leaves no cover placement in a frame of another shape, where no heads leaves one", () => {
    /* The fail-open the live run took: with no heads, a square crop keeps
       the subject whole and cuts whoever stands past it. */
    const open = coverPlacement(PHOTO, CAFE_SUBJECT, SQUARE, [], 200, []);
    expect(open).not.toBeNull();
    expect(crops(open as NonNullable<typeof open>)).toBe(true);
    expect(
      coverPlacement(PHOTO, CAFE_SUBJECT, SQUARE, [], 200, HEADS_UNKNOWN),
    ).toBeNull();
  });

  it("refuses every full-bleed band", () => {
    const band = { x: 0, y: 0, width: 150, height: 600 };
    const small = { x: 0.4, y: 0.3, w: 0.3, h: 0.4 };
    expect(
      bandedPlacement(PHOTO, small, SQUARE, band, "left", {
        heads: [],
        avoid: [],
        minEdge: 200,
        gap: 12,
      }),
    ).not.toBeNull();
    expect(
      bandedPlacement(PHOTO, small, SQUARE, band, "left", {
        heads: HEADS_UNKNOWN,
        avoid: [],
        minEdge: 200,
        gap: 12,
      }),
    ).toBeNull();
  });

  it("draws the whole photo when its subject keeps the rule there", () => {
    const placed = wholePlacement(PHOTO, CAFE_SUBJECT, SQUARE, [], 200);
    expect(placed?.fit).toBe("contain");
    expect(crops(placed as NonNullable<typeof placed>)).toBe(false);
    expect(wholePlacement(PHOTO, CAFE_SUBJECT, SQUARE, [], 500)).toBeNull();
    expect(
      wholePlacement(PHOTO, CAFE_SUBJECT, SQUARE, [SQUARE], 200),
    ).toBeNull();
  });
});

describe("round 25, CB2: no photo layout crops a photo whose heads are unknown", () => {
  let facts: ImageFacts;
  beforeAll(async () => {
    const bytes = await sharp({
      create: { ...PHOTO, channels: 3, background: "#6b625a" },
    })
      .png()
      .toBuffer();
    const measured = await measureImage({
      bytes: new Uint8Array(bytes),
      contentType: "image/png",
    });
    if (!measured) throw new Error("photo did not measure");
    facts = measured;
  });
  const COPY: Pick<
    DesignSpec,
    "headline" | "subheadline" | "cta" | "footerStyle" | "footerLines"
  > = {
    headline: "The Cold Brew Flight",
    subheadline: "Three 150ml tasters for ₦6,000.",
    cta: "Order at the bar",
    footerStyle: "text",
    footerLines: ["Weekdays 8am to 6pm", "9 Akinola Street, Yaba"],
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
  )("%s at %s, fault or none", async (layout, aspect) => {
    const spec = {
      ...specFor(layout, aspect, COPY),
      logoPlacement: "none" as const,
    };
    for (const heads of [HEADS_UNKNOWN, []]) {
      const { document } = await documentFromSpec({
        spec,
        palette: spec.palette as never,
        canvas: canvasFor(aspect),
        image: { key: "design-images/b1/round25-cafe.png" },
        imageFacts: facts,
        subject: CAFE_SUBJECT,
        heads,
        logo: null,
        measurer: monospaceMeasurer(),
      });
      const image = document.elements.find(
        (e): e is ImageElement => e.type === "image",
      );
      if (!image) continue;
      const cut = crops({
        frame: {
          x: image.x,
          y: image.y,
          width: image.width,
          height: image.height,
        },
        fit: image.fit,
        ...image.crop,
      });
      if (heads === HEADS_UNKNOWN) expect(cut, layout).toBe(false);
    }
  });
});
