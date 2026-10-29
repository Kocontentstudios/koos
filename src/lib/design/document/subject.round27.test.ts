// @vitest-environment node
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import type { DesignSpec } from "@/lib/design/spec";
import { drawnImageRect, type ImageFacts } from "./builders/ground";
import { monospaceMeasurer, specFor } from "./fixtures";
import { documentFromSpec } from "./from-spec";
import { measureImage } from "./image-facts";
import type { ImageElement } from "./schema";
import {
  HEADS_UNKNOWN,
  headsForLayout,
  headsUnknown,
  headsWithMargin,
  intersection,
  type SubjectBox,
  subjectOnCanvas,
} from "./subject";

/*
 * Oluwaseyi's ruling of 2026-10-29: fail closed on heads. The look boxed
 * the storefront's heads on upper-floor windows and missed a barista on
 * the cafe (critique-26), so wherever it says people are in the photo, no
 * layout crops it. The grown head boxes stay as a second guard for copy.
 */

/* The storefront look of 2026-10-29 17:51:34 UTC (boutique e9e2726f,
   busy-storefront-24mp.jpg): people at street level, three head boxes on
   the windows above them (critique-26/storefront-look-overlay.png). */
const STOREFRONT = {
  photo: { width: 3991, height: 5987 },
  subject: { x: 0.2, y: 0.08, w: 0.54, h: 0.69 },
  heads: [
    { x: 0.55, y: 0.54, w: 0.09, h: 0.1 },
    { x: 0.65, y: 0.53, w: 0.09, h: 0.09 },
    { x: 0.78, y: 0.53, w: 0.09, h: 0.09 },
  ],
};

/* The cafe look of 2026-10-29 17:49:50 UTC (busy-cafe-espresso.jpg). */
const CAFE = {
  photo: { width: 5242, height: 3744 },
  subject: { x: 0.16, y: 0.26, w: 0.68, h: 0.64 },
  heads: [
    { x: 0.55, y: 0.2, w: 0.19, h: 0.25 },
    { x: 0.66, y: 0.15, w: 0.26, h: 0.35 },
  ],
};

/* A square photo with one person filling the middle. */
const PORTRAIT_SQUARE = {
  photo: { width: 2000, height: 2000 },
  subject: { x: 0.25, y: 0.1, w: 0.5, h: 0.85 },
  heads: [{ x: 0.4, y: 0.12, w: 0.2, h: 0.2 }],
};

const LOOKS = { storefront: STOREFRONT, cafe: CAFE, square: PORTRAIT_SQUARE };

describe("round 27: headsForLayout, the one place a photo may be cropped", () => {
  const grown = headsWithMargin(CAFE.heads);

  it("refuses every crop when people are seen and heads boxed", () => {
    const decided = headsForLayout(true, grown);
    expect(decided.noCrop).toBe("peopleNoCrop");
    expect(headsUnknown(decided.heads)).toBe(true);
    /* The padded boxes stay as the copy's second guard. */
    expect(decided.heads.slice(1)).toEqual(grown);
  });

  it("keeps heads unknown its own reason", () => {
    const decided = headsForLayout(true, []);
    expect(decided.noCrop).toBe("headsUnknown");
    expect(decided.heads).toBe(HEADS_UNKNOWN);
  });

  it("leaves a photo with no people free to crop", () => {
    expect(headsForLayout(false, [])).toEqual({ heads: [], noCrop: null });
    const decided = headsForLayout(false, grown);
    expect(decided.noCrop).toBeNull();
    expect(headsUnknown(decided.heads)).toBe(false);
  });
});

const crops = (
  photo: { width: number; height: number },
  image: ImageElement,
): boolean => {
  const frame = {
    x: image.x,
    y: image.y,
    width: image.width,
    height: image.height,
  };
  const drawn = drawnImageRect(photo, {
    frame,
    fit: image.fit,
    ...image.crop,
  });
  return (
    drawn.x < frame.x - 0.5 ||
    drawn.y < frame.y - 0.5 ||
    drawn.x + drawn.width > frame.x + frame.width + 0.5 ||
    drawn.y + drawn.height > frame.y + frame.height + 0.5
  );
};

async function factsFor(photo: {
  width: number;
  height: number;
}): Promise<ImageFacts> {
  /* A tenth of the real size: placement depends on the shape alone. */
  const width = Math.round(photo.width / 10);
  const height = Math.round(photo.height / 10);
  const bytes = await sharp({
    create: { width, height, channels: 3, background: "#6b625a" },
  })
    .png()
    .toBuffer();
  const measured = await measureImage({
    bytes: new Uint8Array(bytes),
    contentType: "image/png",
  });
  if (!measured) throw new Error("photo did not measure");
  return measured;
}

describe("round 27: no layout crops a photo with people in it", () => {
  const COPY: Pick<
    DesignSpec,
    "headline" | "subheadline" | "cta" | "footerStyle" | "footerLines"
  > = {
    headline: "We Reopen Saturday",
    subheadline: "Hand-tied bouquets from ₦18,000, delivered same day.",
    cta: "Call to order",
    footerStyle: "text",
    footerLines: ["Daily 9am to 7pm", "22 Admiralty Way, Lekki Phase 1"],
  };
  const LAYOUTS = [
    "split-left",
    "banner-bottom",
    "hero-center",
    "quote-card",
    "stat-highlight",
  ] as const;
  const ASPECTS = ["1:1", "4:5", "9:16", "16:9"] as const;
  const cases = (Object.keys(LOOKS) as (keyof typeof LOOKS)[]).flatMap((look) =>
    LAYOUTS.flatMap((layout) =>
      ASPECTS.map((aspect) => [look, layout, aspect] as const),
    ),
  );

  it.each(cases)(
    "%s look, %s at %s: whole, and its copy clear of every padded head",
    async (lookName, layout, aspect) => {
      const look = LOOKS[lookName];
      const facts = await factsFor(look.photo);
      const grownHeads = headsWithMargin(look.heads);
      const { heads } = headsForLayout(true, grownHeads);
      const spec = {
        ...specFor(layout, aspect, COPY),
        logoPlacement: "none" as const,
      };
      const { document, subjectFault } = await documentFromSpec({
        spec,
        palette: spec.palette as never,
        canvas: canvasFor(aspect),
        image: { key: `design-images/b1/round27-${lookName}.png` },
        imageFacts: facts,
        subject: look.subject,
        heads,
        logo: null,
        measurer: monospaceMeasurer(),
      });
      const image = document.elements.find(
        (e): e is ImageElement => e.type === "image" && !e.hidden,
      );
      if (!image) return;
      expect(crops(facts, image), "the photo is cropped").toBe(false);
      /* A faulted layout is refused by the job; only a clean one ships,
         and a clean one keeps copy off the people and the subject. */
      if (subjectFault) return;
      const placement = {
        frame: {
          x: image.x,
          y: image.y,
          width: image.width,
          height: image.height,
        },
        fit: image.fit,
        ...image.crop,
      };
      const guarded: SubjectBox[] = [...grownHeads, look.subject];
      const onCanvas = guarded.map((box) =>
        subjectOnCanvas(facts, box, placement),
      );
      for (const element of document.elements) {
        if (element.hidden) continue;
        if (element.type !== "text" && element.type !== "button") continue;
        for (const box of onCanvas) {
          expect(
            intersection(element, box),
            `${element.id} sits on a person or the subject`,
          ).toBeNull();
        }
      }
    },
  );
});
