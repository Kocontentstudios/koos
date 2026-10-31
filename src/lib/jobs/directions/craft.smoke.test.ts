// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import {
  LAYOUTS,
  LOGO,
  LOGO_ASPECT,
  PALETTE,
  RATIOS,
  REALISTIC,
  specFor,
  syntheticImages,
} from "@/lib/design/document/fixtures";
import { documentFromSpec } from "@/lib/design/document/from-spec";
import { measureImage } from "@/lib/design/document/image-facts";
import {
  createRendererMeasurer,
  type RendererMeasurer,
} from "@/lib/design/document/measure";
import { loadBrandFonts } from "@/lib/design/render/fonts";
import { layoutCraftFaults } from "./craft";

/**
 * The craft check against the real builders: every layout at every ratio,
 * over a photograph, a cut-out and a flat ground, with realistic copy, is
 * clean. A check that flagged good builds would push every direction off
 * its layout; one probe of 360 builds found faults only on the worst-case
 * copy cards, which also report COPY_TOO_LONG.
 */

let measurer: RendererMeasurer;
const IMAGES = syntheticImages();
const facts: Record<string, Awaited<ReturnType<typeof measureImage>>> = {};

beforeAll(async () => {
  measurer = createRendererMeasurer({ fonts: await loadBrandFonts(null) });
  facts.busy = await measureImage(IMAGES.busy);
  facts.cutout = await measureImage(IMAGES.cutout);
});

describe("layoutCraftFaults on the builders", () => {
  for (const layout of LAYOUTS) {
    it(`finds nothing on ${layout} with realistic copy`, async () => {
      for (const ratio of RATIOS) {
        for (const image of [null, "busy", "cutout"] as const) {
          const built = await documentFromSpec({
            spec: specFor(layout, ratio, REALISTIC),
            palette: PALETTE,
            canvas: canvasFor(ratio),
            image: image ? { key: `design-images/b1/${image}.png` } : null,
            imageFacts: image ? facts[image] : null,
            logo: { asset: LOGO, aspect: LOGO_ASPECT },
            measurer,
          });
          expect(
            layoutCraftFaults(built.document),
            `${layout} ${ratio} ${image}`,
          ).toEqual({ hard: null, soft: null });
        }
      }
    }, 60_000);
  }
});
