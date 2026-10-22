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
import {
  type DesignDocument,
  designDocumentSchema,
  MAX_CANVAS_EDGE,
} from "./schema";

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

/* Schema-valid documents a user's edit could produce that no builder would:
   each must render, because the schema is the only gate before satori.
   Round 1's rival accepted a colour word that made satori throw (B1). */
describe("documentElement with hostile but valid documents", () => {
  const base = {
    rotation: 0,
    opacity: 1,
    hidden: false,
    locked: false,
  };
  const CASES: Record<string, DesignDocument["elements"]> = {
    "a button narrower than its padding": [
      {
        ...base,
        id: "b",
        name: "b",
        type: "button",
        x: 0,
        y: 0,
        width: 4,
        height: 30,
        label: "Reserve now",
        fill: "#000000",
        color: "#ffffff",
        radius: 0,
        fontSize: 40,
        fontWeight: 600,
      },
    ],
    /* With break-word, satori never returned on a line narrower than one
       glyph: this case and the button above hung the suite (round 2). */
    "a text box narrower than one letter": [
      {
        ...base,
        id: "n",
        name: "n",
        type: "text",
        x: 0,
        y: 0,
        width: 1,
        height: 60,
        text: "Wide",
        role: "headline",
        font: "heading",
        fontSize: 120,
        fontWeight: 700,
        lineHeight: 1,
        letterSpacing: 2,
        align: "left",
        italic: false,
        color: "#000000",
      },
    ],
    "the tightest letter spacing": [
      {
        ...base,
        id: "t",
        name: "t",
        type: "text",
        x: 0,
        y: 0,
        width: 300,
        height: 60,
        text: "Hello world",
        role: "body",
        font: "body",
        fontSize: 40,
        fontWeight: 400,
        lineHeight: 1.2,
        letterSpacing: -0.5,
        align: "left",
        italic: false,
        color: "#000000",
      },
    ],
    "every geometry field at its bound": [
      {
        ...base,
        id: "s",
        name: "s",
        type: "shape",
        x: -MAX_CANVAS_EDGE * 2,
        y: MAX_CANVAS_EDGE * 2,
        width: MAX_CANVAS_EDGE * 2,
        height: MAX_CANVAS_EDGE * 2,
        fill: "linear-gradient(45deg, #ff0000 0%, #0000ff 100%)",
        borderColor: "#000000",
        borderWidth: MAX_CANVAS_EDGE,
        radius: MAX_CANVAS_EDGE,
      },
      {
        ...base,
        id: "i",
        name: "i",
        type: "image",
        x: 0,
        y: 0,
        width: MAX_CANVAS_EDGE * 2,
        height: MAX_CANVAS_EDGE * 2,
        asset: IMAGE,
        fit: "cover",
        crop: { zoom: 10, focusX: 1, focusY: 0 },
        radius: MAX_CANVAS_EDGE,
      },
    ],
  };

  it.each(Object.keys(CASES))("renders %s", async (name) => {
    const doc = designDocumentSchema.parse({
      version: 1,
      width: 1080,
      height: 1080,
      background: "#FFFFFF",
      elements: CASES[name],
    });
    const png = await rasterize(documentElement(doc, SOURCES), doc, fonts);
    expect(Array.from(png.slice(0, 4))).toEqual(PNG_MAGIC);
  });
});

describe.each(LAYOUTS)("documentElement renders %s", (layout) => {
  it("through satori and react-dom alike, in every combination", async () => {
    for (const ratio of RATIOS) {
      for (const image of [IMAGE, null]) {
        for (const logo of [{ asset: LOGO, aspect: LOGO_ASPECT }, null]) {
          const canvas = canvasFor(ratio);
          const { document: doc } = await documentFromSpec({
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
