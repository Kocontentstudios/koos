// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import { contrastRatio } from "@/lib/design/palette";
import { loadBrandFonts } from "@/lib/design/render/fonts";
import type { DesignSpec } from "@/lib/design/spec";
import { decodePngRgba } from "@/lib/images/png-pixels";
import type { ImageFacts } from "./builders/ground";
import { BUTTON_CONTRAST } from "./builders/shared";
import { copyContrast, withoutCopy } from "./contrast-probe";
import { specFor, testAssets } from "./fixtures";
import { documentFromSpec } from "./from-spec";
import { measureImage } from "./image-facts";
import { createRendererMeasurer, type RendererMeasurer } from "./measure";
import { rasterizeDocument } from "./rasterize";
import type { DesignDocument, DesignElement } from "./schema";
import { intersection, type SubjectBox, subjectOnCanvas } from "./subject";
import { TEST_PROBE_LIMIT_MS } from "./testing-measure";

/*
 * Round 23: the photo full bleed with the copy in a band down the side
 * opposite the subject (hero-center, sideBleed), Oluwaseyi's ruling of
 * 2026-10-28 ("full-bleed with a scrim"). On the stock photos in
 * /tmp/feat-033/fixtures, with the subject boxes the vision look returned
 * for them (/tmp/feat-033/u3-r6/critique-23/fixture-looks.json).
 */

const F = "/tmp/feat-033/fixtures";
const KEY = { key: "design-images/b1/round23.jpg" };
const haveFixtures = [
  "portrait-fashion.jpg",
  "busy-storefront-24mp.jpg",
  "busy-cafe-espresso.jpg",
].every((name) => existsSync(`${F}/${name}`));

/* The cafe's barista and machine, as a builder input on its right: no
   stock photo's look leaves a side free (critique-23/fullbleed-geometry.txt),
   and the bright windows are the hardest ground the veil meets. */
const SIDE_SUBJECT = {
  subject: { x: 0.6, y: 0.2, w: 0.3, h: 0.66 },
  heads: [{ x: 0.66, y: 0.2, w: 0.12, h: 0.18 }],
};

let measurer: RendererMeasurer;
let fonts: Awaited<ReturnType<typeof loadBrandFonts>>;
const photos: Record<
  string,
  { bytes: Uint8Array; contentType: string; facts: ImageFacts }
> = {};

beforeAll(async () => {
  fonts = await loadBrandFonts(null);
  measurer = createRendererMeasurer({
    probeLimitMs: TEST_PROBE_LIMIT_MS,
    fonts,
  });
  if (!haveFixtures) return;
  for (const name of [
    "portrait-fashion.jpg",
    "busy-storefront-24mp.jpg",
    "busy-cafe-espresso.jpg",
  ]) {
    const bytes = new Uint8Array(
      await sharp(readFileSync(`${F}/${name}`))
        .resize(900)
        .jpeg()
        .toBuffer(),
    );
    const facts = await measureImage({ bytes, contentType: "image/jpeg" });
    if (!facts) throw new Error(`${name} did not measure`);
    photos[name] = { bytes, contentType: "image/jpeg", facts };
  }
});

const COPY: Pick<
  DesignSpec,
  "headline" | "subheadline" | "cta" | "footerStyle" | "footerLines"
> = {
  headline: "The Cold Brew Flight",
  subheadline: "Three 150ml tasters for ₦6,000, at the bar.",
  cta: "Ask for Oat Milk",
  footerStyle: "text",
  footerLines: ["Weekdays 8am to 6pm", "9 Akinola Street, Yaba"],
};

async function build(
  name: string,
  look: { subject: SubjectBox; heads: SubjectBox[] },
  aspect: DesignSpec["aspectRatio"],
) {
  const photo = photos[name];
  const spec = {
    ...specFor("hero-center", aspect, COPY),
    logoPlacement: "none" as const,
  };
  const built = await documentFromSpec({
    spec,
    palette: spec.palette as never,
    canvas: canvasFor(aspect),
    image: KEY,
    imageFacts: photo.facts,
    subject: look.subject,
    heads: look.heads,
    logo: null,
    measurer,
  });
  return { ...built, photo };
}

const sideScrim = (doc: DesignDocument) =>
  doc.elements.find(
    (e) =>
      e.type === "shape" &&
      e.id === "scrim" &&
      /linear-gradient\((90|270)deg/.test((e as { fill: string }).fill),
  );
const imageOf = (doc: DesignDocument) =>
  doc.elements.find((e) => e.type === "image") as DesignElement;
const box = (e: DesignElement) => ({
  x: e.x,
  y: e.y,
  width: e.width,
  height: e.height,
});

async function render(
  doc: DesignDocument,
  photo: { bytes: Uint8Array; contentType: string },
) {
  const result = await rasterizeDocument({
    doc,
    assets: { ...testAssets(), [KEY.key]: photo },
    brand: {},
    fonts,
  });
  const png = decodePngRgba(result.bytes);
  if (!png) throw new Error("render did not decode");
  return png;
}

describe.skipIf(!haveFixtures)(
  "round 23: a full-bleed photo with the copy in a side band",
  () => {
    /* The fashion portrait and the storefront facade, which no band
       cleared here, take a band on the subject's outer edge under
       Oluwaseyi's ruling of 2026-10-29: round24.smoke.test.ts. */

    it("a subject on the right: the photo covers the canvas, the copy and its veil stay left of the subject and every head", async () => {
      const { document, subjectFault, photo } = await build(
        "busy-cafe-espresso.jpg",
        SIDE_SUBJECT,
        "16:9",
      );
      expect(subjectFault).toBeNull();
      const image = imageOf(document);
      expect(box(image)).toEqual({
        x: 0,
        y: 0,
        width: document.width,
        height: document.height,
      });
      const scrim = sideScrim(document);
      expect((scrim as { fill: string }).fill).toMatch(
        /^linear-gradient\(270deg/,
      );
      const placement = {
        frame: box(image),
        fit: "cover" as const,
        zoom: (image as { crop: { zoom: number } }).crop.zoom,
        focusX: (image as { crop: { focusX: number } }).crop.focusX,
        focusY: (image as { crop: { focusY: number } }).crop.focusY,
      };
      const onCanvas = [SIDE_SUBJECT.subject, ...SIDE_SUBJECT.heads].map((b) =>
        subjectOnCanvas(photo.facts, b, placement),
      );
      const copy = document.elements.filter(
        (e) => e.type === "text" || e.type === "button",
      );
      for (const element of [...copy, scrim as DesignElement]) {
        for (const kept of onCanvas)
          expect(intersection(box(element), kept)).toBeNull();
      }
    });

    it("a subject on the right: every run of copy is AA on the veiled photo, and the button fill clears 3:1 against it", async () => {
      const { document, photo } = await build(
        "busy-cafe-espresso.jpg",
        SIDE_SUBJECT,
        "16:9",
      );
      const ground = await render(withoutCopy(document), photo);
      for (const run of copyContrast(ground, document)) {
        const element = document.elements.find(
          (e) => e.id === run.id,
        ) as DesignElement & {
          fontSize: number;
          fontWeight: number;
        };
        const large =
          element.fontSize >= 48 ||
          (element.fontSize >= 37 && element.fontWeight >= 700);
        /* The box is wider than the ink: a sliver of pixels between lines
         may fall short, as images.smoke.test.ts allows. */
        expect(large ? run.under3 : run.under45, run.id).toBeLessThanOrEqual(
          0.02,
        );
      }
      const cta = document.elements.find(
        (e) => e.id === "cta",
      ) as DesignElement & {
        fill: string;
        color: string;
      };
      expect(contrastRatio(cta.color, cta.fill)).toBeGreaterThanOrEqual(4.5);
      const behind = await render(
        {
          ...document,
          elements: document.elements.filter((e) => e.id !== "cta"),
        },
        photo,
      );
      let worst = Number.POSITIVE_INFINITY;
      for (
        let y = Math.ceil(cta.y);
        y < Math.floor(cta.y + cta.height);
        y += 2
      ) {
        for (const x of [Math.ceil(cta.x), Math.floor(cta.x + cta.width) - 1]) {
          const at = (y * behind.width + x) * 4;
          const hex = `#${[0, 1, 2].map((i) => behind.pixels[at + i].toString(16).padStart(2, "0")).join("")}`;
          worst = Math.min(worst, contrastRatio(cta.fill, hex));
        }
      }
      expect(worst).toBeGreaterThanOrEqual(BUTTON_CONTRAST);
    });
  },
);
