// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import { contrastRatio } from "@/lib/design/palette";
import { loadBrandFonts } from "@/lib/design/render/fonts";
import type { DesignSpec } from "@/lib/design/spec";
import { encodePngRgba } from "@/lib/images/png-pixels";
import type { ImageFacts } from "./builders/ground";
import { looks } from "./builders/looks";
import { BUTTON_CONTRAST } from "./builders/shared";
import { hasLoneWord } from "./fit";
import { PALETTE, specFor } from "./fixtures";
import { documentFromSpec } from "./from-spec";
import { measureImage } from "./image-facts";
import { createRendererMeasurer, type RendererMeasurer } from "./measure";
import type { DesignDocument, DesignElement } from "./schema";
import {
  coverPlacement,
  cutsAHead,
  SUBJECT_CROPPED,
  type SubjectBox,
  subjectOnCanvas,
} from "./subject";
import { TEST_PROBE_LIMIT_MS } from "./testing-measure";

/*
 * Round 21, the round-8 live critic's craft faults
 * (/tmp/feat-033/critique/u3-live-verdict-round8.md), on the real builders
 * and fonts, with photos shaped like the live fixtures: a 2:3 portrait
 * (fashion), a 2:3 facade (storefront) and a 7:5 espresso bar (cafe).
 */

const PHOTO = { key: "design-images/b1/round21.png" };
/* Hand-measured from /tmp/feat-033/fixtures. */
const PERSON: SubjectBox = { x: 0.17, y: 0.17, w: 0.75, h: 0.83 };
const FACADE: SubjectBox = { x: 0.27, y: 0.16, w: 0.48, h: 0.56 };

let measurer: RendererMeasurer;
let portrait: ImageFacts;
let bar: ImageFacts;

function photo(width: number, height: number) {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    pixels.set(
      [120 + ((i % width) % 90), 110, 90 + Math.floor(i / width / 9), 255],
      i * 4,
    );
  }
  return {
    bytes: encodePngRgba({ width, height, pixels }),
    contentType: "image/png",
  };
}

beforeAll(async () => {
  measurer = createRendererMeasurer({
    probeLimitMs: TEST_PROBE_LIMIT_MS,
    fonts: await loadBrandFonts(null),
  });
  const p = await measureImage(photo(400, 600));
  const b = await measureImage(photo(700, 500));
  if (!p || !b) throw new Error("fixtures did not measure");
  portrait = p;
  bar = b;
});

const build = (
  spec: DesignSpec,
  facts: ImageFacts | null,
  subject: SubjectBox | null,
) =>
  documentFromSpec({
    spec: { ...spec, logoPlacement: "none" },
    palette: spec.palette as typeof PALETTE,
    canvas: canvasFor(spec.aspectRatio),
    image: facts ? PHOTO : null,
    imageFacts: facts,
    subject,
    logo: null,
    measurer,
  });

const FASHION = {
  headline: "The Ire Wrap Dress",
  subheadline: "Sage silk with pearl buttons, only 15 made.",
  cta: "Book a Fitting",
  footerStyle: "bar" as const,
  footerLines: [
    "Priced at ₦78,000 · Sizes 8 – 16",
    "3 Raymond Njoku Street, Ikoyi",
    "Open Tue – Sat · 11am to 6pm",
  ],
};
const imageOf = (doc: DesignDocument) =>
  doc.elements.find((e) => e.type === "image") as DesignElement;
const byId = (doc: DesignDocument, id: string) =>
  doc.elements.find((e) => e.id === id) as DesignElement;

describe("finding 4a: an inset photo keeps clear of the footer bar", () => {
  it("fashion split-left 16:9: a gutter between the print and the bar", async () => {
    const { document, subjectFault } = await build(
      specFor("split-left", "16:9", FASHION),
      portrait,
      PERSON,
    );
    expect(subjectFault).toBeNull();
    const image = imageOf(document);
    const footBar = byId(document, "footer-bar");
    expect((image as { radius?: number }).radius ?? 0).toBeGreaterThan(0);
    expect(footBar.y - (image.y + image.height)).toBeGreaterThanOrEqual(10);
  });
});

describe("finding 4b: no print left floating in its region", () => {
  it("fashion split-left 16:9: the print is on the right margin and the copy takes the freed room", async () => {
    const { document } = await build(
      specFor("split-left", "16:9", FASHION),
      portrait,
      PERSON,
    );
    const image = imageOf(document);
    const headline = byId(document, "headline");
    const margin = Math.round(Math.min(document.width, document.height) * 0.08);
    expect(document.width - (image.x + image.width)).toBeLessThanOrEqual(
      margin / 2 + 1,
    );
    /* The round-8 gap: the copy kept its 52% column and the print sat
       centred in the other half. Now the copy may run past that column,
       up to a margin from the print. */
    const subheadline = byId(document, "subheadline");
    const copyRight = Math.max(
      headline.x + headline.width,
      subheadline.x + subheadline.width,
    );
    expect(copyRight).toBeGreaterThan(document.width * 0.52 - margin);
    expect(copyRight).toBeLessThanOrEqual(image.x - margin + 1);
  });

  it("storefront banner-bottom 4:5: a tall facade is never a thumbnail in the band", async () => {
    /* At round 20 this drew a clean 454 px print in a 1080 px band. */
    const { document, subjectFault } = await build(
      specFor("banner-bottom", "4:5", {
        headline: "Hand-Tied Bouquets",
        subheadline: "From ₦18,000 each.",
        cta: "Call to Order",
        footerStyle: "none",
        footerLines: [],
      }),
      portrait,
      { x: 0.3, y: 0.1, w: 0.4, h: 0.8 },
    );
    const image = imageOf(document);
    expect(
      subjectFault === SUBJECT_CROPPED || image.width >= document.width * 0.6,
    ).toBe(true);
  });

  it("hero-center 16:9: a portrait no bleed or band shows whole stands beside the copy", async () => {
    const { document, subjectFault } = await build(
      specFor("hero-center", "16:9", FASHION),
      portrait,
      PERSON,
    );
    expect(subjectFault).toBeNull();
    const image = imageOf(document);
    const headline = byId(document, "headline");
    expect(image.x + image.width).toBeLessThanOrEqual(headline.x);
  });
});

describe("finding 4c: a button fill clears 3:1 against its field", () => {
  it("fashion text card: brown accent on a blue field is not the fill", async () => {
    const palette = {
      background: "#1E3A8A",
      foreground: "#F5F0E6",
      accent: "#7C2D12",
    };
    const { document } = await build(
      { ...specFor("hero-center", "16:9", FASHION), palette },
      null,
      null,
    );
    const cta = byId(document, "cta") as DesignElement & {
      fill: string;
      color: string;
    };
    expect(contrastRatio(cta.fill, palette.background)).toBeGreaterThanOrEqual(
      BUTTON_CONTRAST,
    );
    expect(contrastRatio(cta.color, cta.fill)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the accent when it already clears 3:1", async () => {
    const { document } = await build(
      specFor("hero-center", "4:5", FASHION),
      null,
      null,
    );
    const cta = byId(document, "cta") as DesignElement & { fill: string };
    expect(cta.fill).toBe(PALETTE.accent);
  });
});

describe("finding 4d: a crop never cuts a person's head", () => {
  /* Cafe s1: the subject box held the machine, and the barista's head to
     its right was cut at the frame's edge. */
  const machine: SubjectBox = { x: 0.29, y: 0.36, w: 0.5, h: 0.56 };
  const barista: SubjectBox = { x: 0.8, y: 0.37, w: 0.16, h: 0.2 };
  const frame = { x: 0, y: 0, width: 700, height: 600 };

  it("keeps the head whole or leaves it out", () => {
    const placement = coverPlacement(bar, machine, frame, [], 0, [barista]);
    expect(placement).not.toBeNull();
    if (!placement) return;
    expect(cutsAHead(bar, [barista], placement)).toBe(false);
    const machineBox = subjectOnCanvas(bar, machine, placement);
    expect(machineBox.x).toBeGreaterThanOrEqual(frame.x - 0.5);
  });

  it("without the head, the closest crop cuts it (the round-8 fault)", () => {
    const placement = coverPlacement(bar, machine, frame, [], 0);
    expect(placement && cutsAHead(bar, [barista], placement)).toBe(true);
  });
});

describe("finding 4f: a headline word alone on its line is avoided", () => {
  it("storefront split-left 4:5: 'This' does not stand alone", async () => {
    const headline = "We're Back — Reopen With Us This Saturday";
    const { document } = await build(
      specFor("split-left", "4:5", {
        headline,
        subheadline:
          "Reopening Saturday 12 December — hand-tied bouquets delivered same day across Lekki.",
        cta: "Order by Phone",
        footerStyle: "text",
        footerLines: ["Open daily 9am to 7pm", "Call 0815 220 9031"],
      }),
      portrait,
      FACADE,
    );
    const el = byId(document, "headline") as DesignElement & {
      fontSize: number;
      width: number;
    };
    expect(
      await hasLoneWord(
        measurer,
        headline,
        looks.headline(el.fontSize, "left"),
        el.width,
      ),
    ).toBe(false);
  });
});
