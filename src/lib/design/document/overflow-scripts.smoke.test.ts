// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import { HEADLINE_STEPS } from "@/lib/design/render/copy-fit";
import { loadBrandFonts } from "@/lib/design/render/fonts";
import { LEGIBLE_FLOOR } from "./builders/looks";
import {
  LAYOUTS,
  LOGO,
  LOGO_ASPECT,
  PALETTE,
  SCRIPTS,
  specFor,
} from "./fixtures";
import { COPY_SHRUNK, COPY_TOO_LONG, documentFromSpec } from "./from-spec";
import { createRendererMeasurer, type RendererMeasurer } from "./measure";
import { INK_TOLERANCE, overflowOf, satoriInk } from "./testing-ink";
import { cacheOgAssets } from "./testing-og-assets";

/**
 * Emoji, CJK and right-to-left copy, which the bundled faces do not cover
 * (B6, B7).
 *
 * next/og draws emoji from Twemoji and fetches Noto for CJK glyphs, so the
 * PNG is drawn in faces no local metrics table knows. Round 1's rival
 * measured with its own replica and overflowed every one of these by up to
 * 374px, and set CJK headlines at 4px because a sentence without spaces
 * read as one word. The fit here measures through satori, so it sees the
 * same fallback faces the render does; this pins that.
 *
 * Network: next/og fetches those faces at render time, and a failed fetch
 * throws the render (emoji) or drops the face for the rest of the process
 * (scripts). testing-og-assets.ts retries and keeps them, so the probe and
 * the render always see the same faces.
 */

cacheOgAssets();

let fonts: Awaited<ReturnType<typeof loadBrandFonts>>;
let measurer: RendererMeasurer;
beforeAll(async () => {
  fonts = await loadBrandFonts(null);
  measurer = createRendererMeasurer({ fonts });
});

describe.each(Object.keys(SCRIPTS) as (keyof typeof SCRIPTS)[])(
  "%s copy",
  (script) => {
    it.each(LAYOUTS)(
      "stays inside its boxes at a readable size in %s",
      async (layout) => {
        for (const ratio of ["4:5", "16:9"] as const) {
          const canvas = canvasFor(ratio);
          const ref = Math.min(canvas.width, canvas.height);
          const { document: doc, copyFault } = await documentFromSpec({
            spec: specFor(layout, ratio, SCRIPTS[script]),
            palette: PALETTE,
            canvas,
            image: null,
            logo: { asset: LOGO, aspect: LOGO_ASPECT },
            measurer,
          });
          const label = `${script} ${layout} ${ratio}`;
          expect(copyFault, label).not.toBe(COPY_TOO_LONG);
          for (const element of doc.elements) {
            if (element.type !== "text" && element.type !== "button") {
              continue;
            }
            if (element.id === "quote-mark") continue;
            /* B7: the CJK headline went to 4px, silently. Nothing goes
               below the legibility floor, and a headline set below the
               type scale has to say so. */
            expect(
              element.fontSize,
              `${label} ${element.id}`,
            ).toBeGreaterThanOrEqual(Math.round(ref * LEGIBLE_FLOOR));
            if (
              element.id === "headline" &&
              element.fontSize <
                Math.round(ref * HEADLINE_STEPS[HEADLINE_STEPS.length - 1])
            ) {
              expect(copyFault, label).toBe(COPY_SHRUNK);
            }
            const ink = await satoriInk(doc, element, fonts);
            expect(ink, `${label} ${element.id} drew nothing`).not.toBeNull();
            if (!ink) continue;
            expect(
              overflowOf(ink, element, doc),
              `${label} ${element.id}`,
            ).toBeLessThanOrEqual(INK_TOLERANCE);
          }
        }
      },
      240_000,
    );
  },
);
