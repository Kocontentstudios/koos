// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import { loadBrandFonts } from "@/lib/design/render/fonts";
import { rasterize } from "@/lib/design/render/rasterize";
import {
  IMAGE,
  LAYOUTS,
  LOGO,
  LOGO_ASPECT,
  PALETTE,
  RATIOS,
  specFor,
  testAssets,
} from "./fixtures";
import { documentFromSpec } from "./from-spec";
import { createRendererMeasurer, type RendererMeasurer } from "./measure";
import { documentElement, drawnElements } from "./render";

/**
 * Acceptance 2: every builder output renders through satori without
 * throwing, and through react-dom into a DOM with the same elements in the
 * same order. One element tree, two renderers, no disagreement about what is
 * on the canvas.
 */

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

let fonts: Awaited<ReturnType<typeof loadBrandFonts>>;
let measurer: RendererMeasurer;
beforeAll(async () => {
  fonts = await loadBrandFonts(null);
  measurer = createRendererMeasurer({ fonts });
});

const SOURCES = Object.fromEntries(
  Object.entries(testAssets()).map(([key, asset]) => [
    key,
    `data:${asset.contentType};base64,${Buffer.from(asset.bytes).toString("base64")}`,
  ]),
);

describe.each(LAYOUTS)("documentElement renders %s", (layout) => {
  it("through satori and react-dom alike, in every combination", async () => {
    for (const ratio of RATIOS) {
      for (const image of [IMAGE, null]) {
        for (const logo of [{ asset: LOGO, aspect: LOGO_ASPECT }, null]) {
          const canvas = canvasFor(ratio);
          const doc = await documentFromSpec({
            spec: specFor(layout, ratio),
            palette: PALETTE,
            canvas,
            image,
            logo,
            measurer,
          });
          const element = documentElement(doc, SOURCES);

          const png = await rasterize(element, canvas, fonts);
          expect(Array.from(png.slice(0, 4))).toEqual(PNG_MAGIC);

          /* Read off react-dom's serialised DOM. render.test.tsx does the
             same through a live jsdom tree; this run covers the measured
             documents the satori half draws. */
          const markup = renderToStaticMarkup(element);
          const ids = Array.from(
            markup.matchAll(/data-element-id="([^"]+)"/g),
            (match) => match[1],
          );
          const expected = drawnElements(doc, SOURCES).map((e) => e.id);
          expect(ids, `${layout} ${ratio}`).toEqual(expected);
          expect(expected).toHaveLength(
            doc.elements.filter((e) => !e.hidden).length,
          );
        }
      }
    }
  }, 240_000);
});
