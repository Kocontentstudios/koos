// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import { loadBrandFonts } from "@/lib/design/render/fonts";
import { LAYOUTS, LOGO, PALETTE, specFor, WORST_CASE } from "./fixtures";
import { documentFromSpec } from "./from-spec";
import { createRendererMeasurer, type RendererMeasurer } from "./measure";
import { designDocumentSchema } from "./schema";
import { TEST_PROBE_LIMIT_MS } from "./testing-measure";

/**
 * Marks at the extremes of shape (a tall 0.15 crest, an 8:1 wordmark) in
 * every corner, with the schema's longest copy: the builders never throw,
 * always produce a valid document, and never put copy in the mark's box.
 * Round 1's critic ran 240 of these against both builders; this keeps them.
 */

let measurer: RendererMeasurer;
beforeAll(async () => {
  measurer = createRendererMeasurer({
    probeLimitMs: TEST_PROBE_LIMIT_MS,
    fonts: await loadBrandFonts(null),
  });
});

const PLACEMENTS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const;

describe.each(LAYOUTS)("%s with an extreme logo", (layout) => {
  it("keeps copy clear of a 0.15 and an 8:1 mark in every corner", async () => {
    for (const aspect of [0.15, 8]) {
      for (const placement of PLACEMENTS) {
        for (const ratio of ["4:5", "16:9"] as const) {
          const label = `${layout} ${ratio} ${placement} aspect=${aspect}`;
          const { document: doc } = await documentFromSpec({
            spec: {
              ...specFor(layout, ratio, WORST_CASE),
              logoPlacement: placement,
              footerStyle: "none",
              footerLines: [],
            },
            palette: PALETTE,
            canvas: canvasFor(ratio),
            image: null,
            logo: { asset: LOGO, aspect },
            measurer,
          });
          const parsed = designDocumentSchema.safeParse(doc);
          expect(parsed.success, `${label}: ${parsed.error?.message}`).toBe(
            true,
          );
          const logo = doc.elements.find((e) => e.type === "logo");
          expect(logo, label).toBeDefined();
          if (!logo) continue;
          for (const copy of doc.elements) {
            if (copy.type !== "text" && copy.type !== "button") continue;
            const clear =
              copy.x >= logo.x + logo.width ||
              logo.x >= copy.x + copy.width ||
              copy.y >= logo.y + logo.height ||
              logo.y >= copy.y + copy.height;
            expect(clear, `${label}: ${copy.id} is in the logo's box`).toBe(
              true,
            );
          }
        }
      }
    }
  }, 240_000);
});
