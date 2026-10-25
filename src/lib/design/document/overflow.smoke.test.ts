// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import { loadBrandFonts } from "@/lib/design/render/fonts";
import { LEGIBLE_FLOOR } from "./builders/looks";
import {
  CAPITALS,
  IMAGE,
  LAYOUTS,
  LOGO,
  LOGO_ASPECT,
  LONG_WORDS,
  OVERSHOOT,
  PALETTE,
  RATIOS,
  specFor,
  WORST_CASE,
} from "./fixtures";
import {
  COPY_SHRUNK,
  COPY_TOO_LONG,
  COPY_WORD_BROKEN,
  documentFromSpec,
} from "./from-spec";
import { createRendererMeasurer, type RendererMeasurer } from "./measure";
import {
  type Box,
  INK_TOLERANCE,
  intersects,
  overflowOf,
  satoriInk,
} from "./testing-ink";
import { TEST_PROBE_LIMIT_MS } from "./testing-measure";

/**
 * Acceptance: no text overflow at worst-case copy (70/140/32 characters and
 * three 60-character footer lines) on every layout and aspect ratio, and
 * none for the copy round 1's critic attacked with.
 *
 * Checked against the pixels, not the layout (testing-ink.ts). Every text
 * element's and button's ink must sit inside its own box and the canvas; no
 * two elements' ink may touch; none may reach under the logo.
 */

let fonts: Awaited<ReturnType<typeof loadBrandFonts>>;
let measurer: RendererMeasurer;

beforeAll(async () => {
  fonts = await loadBrandFonts(null);
  measurer = createRendererMeasurer({
    probeLimitMs: TEST_PROBE_LIMIT_MS,
    fonts,
  });
});

/* What each case may report. Copy at the schema's limits in plain words
   never overflows or breaks a word; in the tightest layouts (a 1:1 card
   under a three-line footer bar) it may be set below the type scale, and
   then says so. Unbroken words must report. Every case, whatever it
   reports, must keep its ink inside its boxes: that is checked below. */
const AT_LIMITS = [null, COPY_SHRUNK];
const CASES = [
  { copy: WORST_CASE, image: null, name: "worst-case flat", faults: AT_LIMITS },
  {
    copy: WORST_CASE,
    image: IMAGE,
    name: "worst-case photo",
    faults: AT_LIMITS,
  },
  {
    copy: OVERSHOOT,
    image: null,
    name: "overshooting glyphs",
    faults: AT_LIMITS,
  },
  {
    copy: CAPITALS,
    image: null,
    name: "wide capitals",
    faults: [null, COPY_SHRUNK, COPY_WORD_BROKEN, COPY_TOO_LONG],
  },
  {
    copy: LONG_WORDS,
    image: null,
    name: "unbroken words",
    faults: [COPY_SHRUNK, COPY_WORD_BROKEN],
  },
];

describe.each(LAYOUTS)("%s at worst-case copy", (layout) => {
  it.each(RATIOS)(
    "keeps every glyph inside its box and the canvas at %s",
    async (ratio) => {
      const checked = new Map<string, Box>();
      const canvas = canvasFor(ratio);
      for (const { copy: words, image, name, faults } of CASES) {
        const { document: doc, copyFault } = await documentFromSpec({
          spec: specFor(layout, ratio, words),
          palette: PALETTE,
          canvas,
          image,
          logo: { asset: LOGO, aspect: LOGO_ASPECT },
          measurer,
        });
        const label = `${layout} ${ratio} ${name}`;
        expect(faults, `${label}: ${copyFault}`).toContain(copyFault);
        const copy = doc.elements.filter(
          (e) => e.type === "text" || e.type === "button",
        );
        expect(copy.map((e) => e.id)).toEqual(
          expect.arrayContaining(["headline", "subheadline", "cta"]),
        );

        const floor = Math.round(
          Math.min(canvas.width, canvas.height) * LEGIBLE_FLOOR,
        );
        const inks: { id: string; ink: Box }[] = [];
        for (const element of copy) {
          if ("fontSize" in element && element.id !== "quote-mark") {
            /* Never the silent 4px type of B9. */
            expect(
              element.fontSize,
              `${label} ${element.id}`,
            ).toBeGreaterThanOrEqual(floor);
          }
          /* Ink depends only on the element's own geometry and type, so an
             element identical to one already checked is not drawn twice. */
          const key = JSON.stringify({ ...element, color: null, fill: null });
          const ink =
            checked.get(key) ?? (await satoriInk(doc, element, fonts));
          if (ink) checked.set(key, ink);
          expect(ink, `${label} ${element.id} drew nothing`).not.toBeNull();
          if (!ink) continue;
          expect(
            overflowOf(ink, element, doc),
            `${label} ${element.id}`,
          ).toBeLessThanOrEqual(INK_TOLERANCE);
          inks.push({ id: element.id, ink });
        }

        for (let i = 0; i < inks.length; i += 1) {
          for (let j = i + 1; j < inks.length; j += 1) {
            expect(
              intersects(inks[i].ink, inks[j].ink),
              `${label}: ${inks[i].id} touches ${inks[j].id}`,
            ).toBe(false);
          }
        }

        const logo = doc.elements.find((e) => e.type === "logo");
        if (logo) {
          const logoBox = {
            left: logo.x,
            top: logo.y,
            right: logo.x + logo.width,
            bottom: logo.y + logo.height,
          };
          for (const { id, ink } of inks) {
            expect(
              intersects(ink, logoBox),
              `${label}: ${id} runs under the logo`,
            ).toBe(false);
          }
        }
      }
    },
    300_000,
  );
});
