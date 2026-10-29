// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import { contrastRatio } from "@/lib/design/palette";
import { loadBrandFonts } from "@/lib/design/render/fonts";
import type { DesignSpec } from "@/lib/design/spec";
import { decodePngRgba } from "@/lib/images/png-pixels";
import { photoPlace } from "@/lib/jobs/directions/render";
import type { ImageFacts } from "./builders/ground";
import { BUTTON_CONTRAST } from "./builders/shared";
import { copyContrast, withoutCopy } from "./contrast-probe";
import { specFor, testAssets } from "./fixtures";
import { documentFromSpec } from "./from-spec";
import { measureImage } from "./image-facts";
import { createRendererMeasurer, type RendererMeasurer } from "./measure";
import { rasterizeDocument } from "./rasterize";
import type { DesignDocument, DesignElement } from "./schema";
import {
  BAND_COVER_MAX,
  type BandSide,
  bandCover,
  intersection,
  measureSubject,
  SUBJECT_GAP,
  type SubjectBox,
  subjectOnCanvas,
} from "./subject";
import { TEST_PROBE_LIMIT_MS } from "./testing-measure";

/*
 * Round 24, Oluwaseyi's ruling of 2026-10-29: over a full-bleed photo the
 * copy band may lie on the outer edge of the subject box under a dark
 * veil, never on a face or head box and never on more than a quarter of
 * the box's width (or height, for a top or bottom band); text AA and the
 * button 3:1 on the render; the side covering least wins. The fashion
 * portrait at 16:9 and the storefront at 4:5 get a full bleed, not a
 * mirror of their beside sibling.
 *
 * On the stock photos in /tmp/feat-033/fixtures, with every look the
 * vision model returned for them
 * (/tmp/feat-033/u3-r6/critique-23/fixture-looks.json).
 */

const F = "/tmp/feat-033/fixtures";
const LOOKS = "/tmp/feat-033/u3-r6/critique-23/fixture-looks.json";
const KEY = { key: "design-images/b1/round24.jpg" };
const CASES = [
  ["portrait-fashion.jpg", "16:9"],
  ["busy-storefront-24mp.jpg", "4:5"],
  ["busy-cafe-espresso.jpg", "1:1"],
] as const;
const haveFixtures =
  existsSync(LOOKS) && CASES.every(([name]) => existsSync(`${F}/${name}`));

interface Look {
  subject: SubjectBox;
  heads: SubjectBox[];
}

let measurer: RendererMeasurer;
let fonts: Awaited<ReturnType<typeof loadBrandFonts>>;
let looks: Record<string, Look[]> = {};
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
  looks = JSON.parse(readFileSync(LOOKS, "utf8"));
  for (const [name] of CASES) {
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
}, 60_000);

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
  look: Look,
  aspect: DesignSpec["aspectRatio"],
) {
  const spec = {
    ...specFor("hero-center", aspect, COPY),
    logoPlacement: "none" as const,
  };
  return documentFromSpec({
    spec,
    palette: spec.palette as never,
    canvas: canvasFor(aspect),
    image: KEY,
    imageFacts: photos[name].facts,
    subject: look.subject,
    heads: look.heads,
    logo: null,
    measurer,
  });
}

const SIDES: Record<string, BandSide> = {
  "270": "left",
  "90": "right",
  "0": "top",
  "180": "bottom",
};

function bandOf(doc: DesignDocument) {
  const scrim = doc.elements.find((e) => e.id === "scrim") as
    | (DesignElement & { fill: string })
    | undefined;
  const angle = scrim && /^linear-gradient\((\d+)deg/.exec(scrim.fill)?.[1];
  return scrim && angle ? { scrim, side: SIDES[angle] } : null;
}

function placementOf(doc: DesignDocument) {
  const image = doc.elements.find(
    (e) => e.type === "image",
  ) as DesignElement & {
    crop: { zoom: number; focusX: number; focusY: number };
  };
  return {
    frame: {
      x: image.x,
      y: image.y,
      width: image.width,
      height: image.height,
    },
    fit: "cover" as const,
    ...image.crop,
  };
}

const box = (e: DesignElement) => ({
  x: e.x,
  y: e.y,
  width: e.width,
  height: e.height,
});

async function render(doc: DesignDocument, name: string) {
  const photo = photos[name];
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
  "round 24: the band may lie on the subject's outer edge, never on a head",
  () => {
    it.each([
      ["portrait-fashion.jpg", "16:9"],
      ["busy-storefront-24mp.jpg", "4:5"],
    ] as const)(
      "%s at %s: every look gets a full bleed with a band, not a print beside the copy",
      async (name, aspect) => {
        for (const look of looks[name]) {
          const { document, subjectFault } = await build(name, look, aspect);
          expect(subjectFault).toBeNull();
          const band = bandOf(document);
          expect(band, JSON.stringify(look.subject)).not.toBeNull();
          const place = photoPlace(document);
          expect(["behind", "bleed"]).toContain(place?.arrangement);
          const image = box(
            document.elements.find((e) => e.type === "image") as DesignElement,
          );
          /* Full bleed: off the top and the bottom, and at least one side. */
          expect(image.y).toBe(0);
          expect(image.y + image.height).toBe(document.height);
          expect(
            image.x === 0 || image.x + image.width === document.width,
          ).toBe(true);
        }
      },
      120_000,
    );

    it.each(CASES)(
      "%s at %s, every look: heads clear of the band and its copy, the band on at most a quarter of the subject",
      async (name, aspect) => {
        for (const look of looks[name]) {
          const { document } = await build(name, look, aspect);
          const band = bandOf(document);
          const placement = placementOf(document);
          const facts = photos[name].facts;
          const report = measureSubject(
            document,
            facts,
            look.subject,
            look.heads,
          );
          expect(report?.overlaps, JSON.stringify(look.subject)).toEqual([]);
          expect(report?.visibleShare).toBeGreaterThan(0.995);
          if (!band) continue;
          const subject = subjectOnCanvas(facts, look.subject, placement);
          expect(
            bandCover(subject, box(band.scrim), band.side),
          ).toBeLessThanOrEqual(BAND_COVER_MAX + 1e-6);
          const gap = Math.min(document.width, document.height) * SUBJECT_GAP;
          const copy = document.elements.filter(
            (e) => e.type === "text" || e.type === "button",
          );
          for (const head of look.heads) {
            const onCanvas = subjectOnCanvas(facts, head, placement);
            expect(intersection(onCanvas, box(band.scrim))).toBeNull();
            for (const element of copy) {
              expect(
                intersection(
                  {
                    x: onCanvas.x - gap,
                    y: onCanvas.y - gap,
                    width: onCanvas.width + gap * 2,
                    height: onCanvas.height + gap * 2,
                  },
                  box(element),
                ),
                element.id,
              ).toBeNull();
            }
          }
        }
      },
      120_000,
    );

    it.each([
      ["portrait-fashion.jpg", "16:9"],
      ["busy-storefront-24mp.jpg", "4:5"],
    ] as const)(
      "%s at %s, every look: text AA and the button 3:1, measured on the render",
      async (name, aspect) => {
        for (const look of looks[name]) {
          const { document } = await build(name, look, aspect);
          const ground = await render(withoutCopy(document), name);
          for (const run of copyContrast(ground, document)) {
            const element = document.elements.find(
              (e) => e.id === run.id,
            ) as DesignElement & { fontSize: number; fontWeight: number };
            const large =
              element.fontSize >= 48 ||
              (element.fontSize >= 37 && element.fontWeight >= 700);
            /* The box is wider than the ink: a sliver of pixels between
               lines may fall short, as images.smoke.test.ts allows. */
            expect(
              large ? run.under3 : run.under45,
              `${name} ${run.id}`,
            ).toBeLessThanOrEqual(0.02);
          }
          const cta = document.elements.find(
            (e) => e.id === "cta",
          ) as DesignElement & { fill: string; color: string };
          expect(contrastRatio(cta.color, cta.fill)).toBeGreaterThanOrEqual(
            4.5,
          );
          const behind = await render(
            {
              ...document,
              elements: document.elements.filter((e) => e.id !== "cta"),
            },
            name,
          );
          let worst = Number.POSITIVE_INFINITY;
          for (
            let y = Math.ceil(cta.y);
            y < Math.floor(cta.y + cta.height);
            y += 2
          ) {
            for (const x of [
              Math.ceil(cta.x),
              Math.floor(cta.x + cta.width) - 1,
            ]) {
              const at = (y * behind.width + x) * 4;
              const hex = `#${[0, 1, 2]
                .map((i) => behind.pixels[at + i].toString(16).padStart(2, "0"))
                .join("")}`;
              worst = Math.min(worst, contrastRatio(cta.fill, hex));
            }
          }
          expect(worst, name).toBeGreaterThanOrEqual(BUTTON_CONTRAST);
        }
      },
      180_000,
    );
  },
);

/* Round-23 live cafe, traced (critique-24/trace-cafe): the look put a
   barista's head past the subject box. hero-center's 46% beside panel
   could not hold the subject with that head at its least size, so it
   reported the subject covered, and with split-left and banner-bottom
   cropping it the pair shipped as two cards. Real fonts: the job harness
   measures text with a monospace stub, under which the photo-above band
   fits and the failure does not show. */
describe.skipIf(!haveFixtures)(
  "round 24: hero-center on the traced cafe look",
  () => {
    const TRACED: Look = {
      subject: { x: 0.16, y: 0.26, w: 0.64, h: 0.61 },
      heads: [
        { x: 0.58, y: 0.16, w: 0.19, h: 0.24 },
        { x: 0.69, y: 0.11, w: 0.24, h: 0.33 },
      ],
    };
    const LIVE_S1: typeof COPY = {
      headline: "Three Tasters. ₦6,000.",
      subheadline:
        "A cold brew flight — three 150ml tasters for ₦6,000, or go long with the 1-litre bottle.",
      cta: "Ask for oat milk",
      footerStyle: "text",
      footerLines: [
        "Bottle and two glasses ₦15,500",
        "Weekdays 8am to 6pm",
        "9 Akinola Street, Yaba",
      ],
    };

    it("shows the bar whole beside the copy, its heads whole, nothing on it", async () => {
      const name = "busy-cafe-espresso.jpg";
      for (const look of [
        TRACED,
        { ...TRACED, subject: { ...TRACED.subject, w: 0.6 } },
      ]) {
        const spec = {
          ...specFor("hero-center", "1:1", LIVE_S1),
          logoPlacement: "none" as const,
        };
        const { document, subjectFault } = await documentFromSpec({
          spec,
          palette: spec.palette as never,
          canvas: canvasFor("1:1"),
          image: KEY,
          imageFacts: photos[name].facts,
          subject: look.subject,
          heads: look.heads,
          logo: null,
          measurer,
        });
        expect(subjectFault, JSON.stringify(look.subject)).toBeNull();
        const report = measureSubject(
          document,
          photos[name].facts,
          look.subject,
          look.heads,
        );
        expect(report?.ok).toBe(true);
        expect(photoPlace(document)?.arrangement).toBe("beside");
      }
    }, 60_000);
  },
);
