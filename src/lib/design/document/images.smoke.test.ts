// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import { loadBrandFonts } from "@/lib/design/render/fonts";
import { decodePngRgba } from "@/lib/images/png-pixels";
import { hexToRgb, type ImageFacts } from "./builders/ground";
import { copyContrast, withoutCopy } from "./contrast-probe";
import {
  CUTOUT_SUBJECT,
  type LAYOUTS,
  LOGO,
  LOGO_ASPECT,
  PALETTE,
  RATIOS,
  specFor,
  syntheticImages,
  testAssets,
} from "./fixtures";
import { documentFromSpec } from "./from-spec";
import { measureImage } from "./image-facts";
import { createRendererMeasurer, type RendererMeasurer } from "./measure";
import { rasterizeDocument } from "./rasterize";
import type {
  AssetRef,
  DesignDocument,
  DesignElement,
  ImageElement,
} from "./schema";
import { TEST_PROBE_LIMIT_MS } from "./testing-measure";

/**
 * The visual verdict's two image findings, measured on renders:
 *
 *  1. A cut-out is contained, never cropped: its subject and shadow are
 *     drawn whole, clear of the edges of the frame that clips them.
 *  2. Copy over a photograph clears 4.5:1 against the pixels actually
 *     behind it, while a bright photo is left bright (no grey veil) and a
 *     dark one is left dark.
 */

const IMAGES = syntheticImages();
const KEYS: Record<keyof typeof IMAGES, AssetRef> = {
  white: { key: "design-images/b1/white.png" },
  black: { key: "design-images/b1/black.png" },
  busy: { key: "design-images/b1/busy.png" },
  cutout: { key: "design-images/b1/cutout.png" },
  sky: { key: "design-images/b1/sky.png" },
};

let fonts: Awaited<ReturnType<typeof loadBrandFonts>>;
let measurer: RendererMeasurer;
const facts = {} as Record<keyof typeof IMAGES, ImageFacts>;

beforeAll(async () => {
  fonts = await loadBrandFonts(null);
  measurer = createRendererMeasurer({
    probeLimitMs: TEST_PROBE_LIMIT_MS,
    fonts,
  });
  for (const name of Object.keys(IMAGES) as (keyof typeof IMAGES)[]) {
    const measured = await measureImage(IMAGES[name]);
    if (!measured) throw new Error(`${name} did not measure`);
    facts[name] = measured;
  }
});

async function build(
  layout: (typeof LAYOUTS)[number],
  ratio: (typeof RATIOS)[number],
  name: keyof typeof IMAGES,
) {
  const { document } = await documentFromSpec({
    spec: specFor(layout, ratio),
    palette: PALETTE,
    canvas: canvasFor(ratio),
    image: KEYS[name],
    imageFacts: facts[name],
    logo: { asset: LOGO, aspect: LOGO_ASPECT },
    measurer,
  });
  return document;
}

async function render(doc: DesignDocument, name: keyof typeof IMAGES) {
  const result = await rasterizeDocument({
    doc,
    assets: { ...testAssets(), [KEYS[name].key]: IMAGES[name] },
    brand: {},
    fonts,
  });
  const png = decodePngRgba(result.bytes);
  if (!png) throw new Error("render did not decode");
  return png;
}

describe("measureImage", () => {
  it("tells a cut-out from a photograph and finds the subject in it", () => {
    expect(facts.white.cutout).toBe(false);
    expect(facts.busy.cutout).toBe(false);
    expect(facts.cutout.cutout).toBe(true);
    const { ink } = facts.cutout;
    /* The box may be a cell generous on each side, never short: a subject
       larger than its box would be cut by a placement trusting it. */
    expect(ink.left).toBeLessThanOrEqual(CUTOUT_SUBJECT.left);
    expect(ink.top).toBeLessThanOrEqual(CUTOUT_SUBJECT.top);
    expect(ink.right).toBeGreaterThanOrEqual(CUTOUT_SUBJECT.right);
    expect(ink.bottom).toBeGreaterThanOrEqual(CUTOUT_SUBJECT.bottom);
    expect(ink.left).toBeGreaterThan(CUTOUT_SUBJECT.left - 0.05);
    expect(ink.bottom).toBeLessThan(CUTOUT_SUBJECT.bottom + 0.05);
  });

  it("reads natural size from the file, not the grid", () => {
    expect(facts.white.width).toBe(300);
    expect(facts.white.height).toBe(200);
  });

  it("returns null for bytes that are not an image", async () => {
    expect(
      await measureImage({
        bytes: new Uint8Array([1, 2, 3, 4]),
        contentType: "image/png",
      }),
    ).toBeNull();
  });
});

/** The bounding box of the cut-out's visible pixels in a render: anything
 *  that is not the canvas background colour, inside the image frame. */
function subjectInk(
  png: { width: number; height: number; pixels: Uint8Array },
  frame: ImageElement,
  background: [number, number, number],
) {
  let box: { left: number; top: number; right: number; bottom: number } | null =
    null;
  for (let y = frame.y; y < frame.y + frame.height; y += 1) {
    for (let x = frame.x; x < frame.x + frame.width; x += 1) {
      const at = (y * png.width + x) * 4;
      const differs = [0, 1, 2].some(
        (i) => Math.abs(png.pixels[at + i] - background[i]) > 6,
      );
      if (!differs) continue;
      box = box
        ? {
            left: Math.min(box.left, x),
            top: Math.min(box.top, y),
            right: Math.max(box.right, x + 1),
            bottom: Math.max(box.bottom, y + 1),
          }
        : { left: x, top: y, right: x + 1, bottom: y + 1 };
    }
  }
  return box;
}

describe("a cut-out subject", () => {
  for (const layout of [
    "banner-bottom",
    "split-left",
    "hero-center",
    "quote-card",
    "stat-highlight",
  ] as const) {
    it.each(RATIOS)(`is drawn whole in ${layout} at %s`, async (ratio) => {
      const doc = await build(layout, ratio, "cutout");
      const image = doc.elements.find(
        (e): e is ImageElement => e.type === "image",
      );
      if (!image) throw new Error("no image element");
      expect(image.fit).toBe("contain");
      /* Only the image, on the plain background, so nothing else is ink. */
      const alone: DesignDocument = { ...doc, elements: [image] };
      const png = await render(alone, "cutout");
      const ink = subjectInk(png, image, hexToRgb(doc.background));
      expect(ink, `${layout} ${ratio}: nothing drawn`).not.toBeNull();
      if (!ink) return;
      /* Clear of every edge of the frame that clips it: a crop leaves the
         subject flush against the edge it was cut at. */
      const label = `${layout} ${ratio}`;
      expect(ink.left, label).toBeGreaterThan(image.x);
      expect(ink.top, label).toBeGreaterThan(image.y);
      expect(ink.right, label).toBeLessThan(image.x + image.width);
      expect(ink.bottom, label).toBeLessThan(image.y + image.height);
      /* And not shrunk to a stamp: at least a third of the frame's height
         or width, whichever binds. */
      expect(
        Math.max(
          (ink.bottom - ink.top) / image.height,
          (ink.right - ink.left) / image.width,
        ),
        label,
      ).toBeGreaterThan(0.33);
    });
  }
});

/* U3 live critique: in the card layouts the photo spilled past the card's
   rounded border with a jagged edge, because the card was laid over a
   full-bleed image. The image lives inside the card now. Checked on the
   pixels: with only the card, the image and its veil drawn, everything
   outside the card is the flat ground, including the corners the radius
   cuts away. */
describe("an image in a card layout", () => {
  const CARD_PARTS = new Set(["card", "image", "scrim", "card-edge"]);

  function outsideCard(
    png: { width: number; height: number; pixels: Uint8Array },
    card: DesignElement & { radius: number },
    ground: [number, number, number],
  ): number {
    const r = card.radius;
    const inCard = (x: number, y: number) => {
      const px = x + 0.5;
      const py = y + 0.5;
      if (
        px < card.x - 1 ||
        py < card.y - 1 ||
        px > card.x + card.width + 1 ||
        py > card.y + card.height + 1
      ) {
        return false;
      }
      /* Distance from the nearest corner circle's centre, for the four
         corner squares; one pixel of antialiasing allowed. */
      const cx = Math.min(Math.max(px, card.x + r), card.x + card.width - r);
      const cy = Math.min(Math.max(py, card.y + r), card.y + card.height - r);
      return Math.hypot(px - cx, py - cy) <= r + 1.5;
    };
    let spilled = 0;
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        if (inCard(x, y)) continue;
        const at = (y * png.width + x) * 4;
        const differs = [0, 1, 2].some(
          (i) => Math.abs(png.pixels[at + i] - ground[i]) > 6,
        );
        if (differs) spilled += 1;
      }
    }
    return spilled;
  }

  for (const layout of ["quote-card", "stat-highlight"] as const) {
    for (const name of ["cutout", "busy", "white"] as const) {
      it.each(["4:5", "1:1", "16:9"] as const)(
        `stays inside the card's rounded border: ${layout} with ${name} at %s`,
        async (ratio) => {
          const doc = await build(layout, ratio, name);
          const card = doc.elements.find((e) => e.id === "card");
          const image = doc.elements.find(
            (e): e is ImageElement => e.type === "image",
          );
          if (card?.type !== "shape" || !image) {
            throw new Error("no card or no image");
          }
          const label = `${layout} ${ratio} ${name}`;
          expect(image.x, label).toBeGreaterThanOrEqual(card.x);
          expect(image.y, label).toBeGreaterThanOrEqual(card.y);
          expect(image.x + image.width, label).toBeLessThanOrEqual(
            card.x + card.width,
          );
          expect(image.y + image.height, label).toBeLessThanOrEqual(
            card.y + card.height,
          );
          /* A cut-out may sit in a room beside the logo, not in the card's
             corners, so only a photograph takes the card's radius; the
             pixel check below holds for both. */
          if (name !== "cutout") expect(image.radius, label).toBe(card.radius);
          const parts: DesignDocument = {
            ...doc,
            elements: doc.elements.filter((e) => CARD_PARTS.has(e.id)),
          };
          const png = await render(parts, name);
          expect(outsideCard(png, card, hexToRgb(doc.background)), label).toBe(
            0,
          );
        },
      );
    }
  }
});

/* Round 2: on a square canvas the cut-out did not fit above the copy at its
   first share, fell through to the photo path, and was laid under a veil
   with the copy across it, a grey slab on a cream card. It now steps down
   to a smaller share and stays above the copy, unveiled. */
describe("a cut-out on a card", () => {
  for (const layout of ["quote-card", "stat-highlight"] as const) {
    it.each(["1:1", "4:5", "16:9"] as const)(
      `sits above the copy with no veil: ${layout} at %s`,
      async (ratio) => {
        const doc = await build(layout, ratio, "cutout");
        const label = `${layout} ${ratio}`;
        expect(
          doc.elements.some((e) => e.id === "scrim"),
          label,
        ).toBe(false);
        const image = doc.elements.find((e) => e.type === "image");
        const copyTop = Math.min(
          ...doc.elements
            .filter((e) => ["quote-mark", "headline"].includes(e.id))
            .map((e) => e.y),
        );
        if (!image) throw new Error(`${label}: no image`);
        expect(image.y + image.height, label).toBeLessThanOrEqual(copyTop);
      },
    );
  }
});

describe("copy over a photograph", () => {
  const OVER_PHOTO = ["hero-center", "quote-card", "stat-highlight"] as const;

  for (const layout of OVER_PHOTO) {
    for (const name of ["white", "black", "busy", "cutout"] as const) {
      it(`clears contrast on the pixels behind it: ${layout} over ${name}`, async () => {
        for (const ratio of ["4:5", "16:9"] as const) {
          const doc = await build(layout, ratio, name);
          const ground = await render(withoutCopy(doc), name);
          for (const run of copyContrast(ground, doc)) {
            const label = `${layout} ${ratio} ${name} ${run.id}`;
            /* Large display type (the headline, the quote mark) needs 3:1;
               everything else 4.5:1. Measured over the element's whole box,
               including the gaps between lines. */
            expect(run.under3, label).toBeLessThanOrEqual(0.005);
            if (run.id !== "headline" && run.id !== "quote-mark") {
              expect(run.under45, label).toBeLessThanOrEqual(0.01);
            }
          }
        }
      });
    }
  }

  it("leaves a bright photo bright: dark copy and no veil", async () => {
    const doc = await build("hero-center", "4:5", "white");
    expect(doc.elements.find((e) => e.id === "scrim")).toBeUndefined();
    const headline = doc.elements.find((e) => e.id === "headline");
    expect(headline?.type === "text" && headline.color).toBe(
      PALETTE.foreground,
    );
  });

  it("leaves a dark photo dark: white copy and no veil", async () => {
    const doc = await build("hero-center", "4:5", "black");
    expect(doc.elements.find((e) => e.id === "scrim")).toBeUndefined();
    const headline = doc.elements.find((e) => e.id === "headline");
    expect(headline?.type === "text" && headline.color).toBe("#FFFFFF");
  });

  it("veils a busy photo, only as much as it needs", async () => {
    const doc = await build("hero-center", "4:5", "busy");
    const scrim = doc.elements.find((e) => e.id === "scrim");
    expect(scrim?.type).toBe("shape");
    if (scrim?.type !== "shape") return;
    const alphas = scrimStops(scrim.fill).map(([, alpha]) => alpha);
    expect(Math.max(...alphas)).toBeGreaterThan(0.3);
    expect(Math.max(...alphas)).toBeLessThan(1);
    /* Clear over the top of the frame, where there is no copy. */
    expect(alphas[0]).toBe(0);
  });
});

/** A scrim's stops as [position share, alpha]. */
function scrimStops(fill: string): [number, number][] {
  return Array.from(
    fill.matchAll(/rgba\(\d+,\d+,\d+,([\d.]+)\) ([\d.]+)%/g),
    (m) => [Number(m[2]) / 100, Number(m[1])],
  );
}

/* Round 4: a 0 to 0.55 ramp over 17% of a square post laid a band across
   a sky, and four stops at 50.3% cut a hard edge through a portrait. */
describe("the veil over a photograph", () => {
  it("never rises in a band: every scrim ramps over at least 20% of its box", async () => {
    let scrims = 0;
    for (const layout of [
      "hero-center",
      "quote-card",
      "stat-highlight",
    ] as const) {
      for (const ratio of RATIOS) {
        for (const name of ["busy", "sky"] as const) {
          const doc = await build(layout, ratio, name);
          const scrim = doc.elements.find((e) => e.id === "scrim");
          if (scrim?.type !== "shape") continue;
          scrims += 1;
          const label = `${layout} ${ratio} ${name}`;
          const stops = scrimStops(scrim.fill);
          expect(stops.length, label).toBeGreaterThanOrEqual(2);
          for (let i = 1; i < stops.length; i += 1) {
            expect(stops[i][0], label).toBeGreaterThan(stops[i - 1][0]);
          }
          const peak = Math.max(...stops.map(([, alpha]) => alpha));
          const reached = stops.find(([, alpha]) => alpha >= peak)?.[0] ?? 0;
          const [[at0, alpha0], [at1, alpha1]] = stops;
          /* Where the veil leaves zero, extended past the box edge when it
             starts already veiled. */
          const clear =
            alpha0 === 0
              ? Math.max(...stops.filter(([, a]) => a === 0).map(([at]) => at))
              : at0 - (alpha0 * (at1 - at0)) / (alpha1 - alpha0);
          expect(reached - clear, label).toBeGreaterThanOrEqual(0.2);
        }
      }
    }
    expect(scrims).toBeGreaterThan(6);
  });

  it("keeps a sky bright: copy across sky and stone does not grey the photo", async () => {
    for (const ratio of ["1:1", "4:5"] as const) {
      const doc = await build("hero-center", ratio, "sky");
      const ground = await render(withoutCopy(doc), "sky");
      const plain = await render(
        { ...doc, elements: doc.elements.filter((e) => e.type === "image") },
        "sky",
      );
      const meanLuminance = (png: typeof ground) => {
        let sum = 0;
        let count = 0;
        for (let i = 0; i < png.pixels.length; i += 4 * 7) {
          const [r, g, b] = [
            png.pixels[i],
            png.pixels[i + 1],
            png.pixels[i + 2],
          ];
          sum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          count += 1;
        }
        return sum / count;
      };
      /* Round 4 left the square post 61% of its light (a black veil over
         the sky for white copy); dark copy over a light veil keeps all of
         it, and the 4:5 post, mostly stone under the copy, keeps 78% under
         the black veil its stone needs. */
      expect(meanLuminance(ground), ratio).toBeGreaterThan(
        meanLuminance(plain) * 0.75,
      );
      for (const run of copyContrast(ground, doc)) {
        expect(run.under3, `${ratio} ${run.id}`).toBeLessThanOrEqual(0.005);
        if (run.id !== "headline") {
          expect(run.under45, `${ratio} ${run.id}`).toBeLessThanOrEqual(0.01);
        }
      }
    }
  });
});
