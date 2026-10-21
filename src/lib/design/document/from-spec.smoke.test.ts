// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import { logoBoxIn } from "@/lib/design/logo-placement";
import { contrastRatio } from "@/lib/design/palette";
import { loadBrandFonts } from "@/lib/design/render/fonts";
import type { DesignSpec } from "@/lib/design/spec";
import {
  IMAGE,
  LAYOUTS,
  LOGO,
  LOGO_ASPECT,
  PALETTE,
  RATIOS,
  REALISTIC,
  specFor,
  WORST_CASE,
} from "./fixtures";
import { documentFromSpec } from "./from-spec";
import { createRendererMeasurer, type RendererMeasurer } from "./measure";
import {
  type DesignDocument,
  type DesignElement,
  designDocumentSchema,
} from "./schema";

/**
 * Acceptance 1: the schema accepts every document the builders produce, for
 * all 5 layouts x 4 aspect ratios x {image, no image} x {logo, no logo}, at
 * realistic and at worst-case copy lengths. Plus the structural promises the
 * builders make: copy inside the canvas, the logo exactly where logoBoxIn
 * puts it, and the same input always giving the same document.
 */

let measurer: RendererMeasurer;
beforeAll(async () => {
  measurer = createRendererMeasurer({ fonts: await loadBrandFonts(null) });
});

const COPIES = { realistic: REALISTIC, "worst-case": WORST_CASE } as const;

function build(
  spec: DesignSpec,
  withImage: boolean,
  withLogo: boolean,
): Promise<DesignDocument> {
  return documentFromSpec({
    spec,
    palette: PALETTE,
    canvas: canvasFor(spec.aspectRatio),
    image: withImage ? IMAGE : null,
    logo: withLogo ? { asset: LOGO, aspect: LOGO_ASPECT } : null,
    measurer,
  });
}

function byId(doc: DesignDocument, id: string): DesignElement | undefined {
  return doc.elements.find((e) => e.id === id);
}

describe.each(LAYOUTS)("documentFromSpec: %s", (layout) => {
  it.each(Object.keys(COPIES) as (keyof typeof COPIES)[])(
    "produces schema-valid documents in every combination (%s copy)",
    async (copyName) => {
      for (const ratio of RATIOS) {
        const spec = specFor(layout, ratio, COPIES[copyName]);
        const canvas = canvasFor(ratio);
        for (const withImage of [true, false]) {
          for (const withLogo of [true, false]) {
            const doc = await build(spec, withImage, withLogo);
            const label = `${layout} ${ratio} image=${withImage} logo=${withLogo}`;
            const parsed = designDocumentSchema.safeParse(doc);
            expect(parsed.success, `${label}: ${parsed.error?.message}`).toBe(
              true,
            );
            expect(doc.width).toBe(canvas.width);
            expect(doc.height).toBe(canvas.height);

            for (const id of ["headline", "subheadline", "cta"]) {
              const element = byId(doc, id);
              expect(element, `${label}: ${id}`).toBeDefined();
              if (!element) continue;
              expect(element.x).toBeGreaterThanOrEqual(0);
              expect(element.y).toBeGreaterThanOrEqual(0);
              expect(element.x + element.width).toBeLessThanOrEqual(
                canvas.width,
              );
              expect(element.y + element.height).toBeLessThanOrEqual(
                canvas.height,
              );
            }

            const image = byId(doc, "image");
            expect(Boolean(image), label).toBe(withImage);
            if (image?.type === "image") {
              expect(image.asset).toEqual(IMAGE);
              expect(image.crop).toEqual({ zoom: 1, focusX: 0.5, focusY: 0.5 });
            }

            const logo = byId(doc, "logo");
            expect(Boolean(logo), label).toBe(withLogo);
            if (logo) {
              const expected = logoBoxIn({
                placement: spec.logoPlacement,
                layout,
                width: canvas.width,
                height: canvas.height,
                aspect: LOGO_ASPECT,
              });
              if (!expected) throw new Error("no logo box");
              expect(logo.x).toBe(Math.round(expected.left));
              expect(logo.y).toBe(Math.round(expected.top));
              /* Drawn last, so nothing the builder adds can cover the mark. */
              expect(doc.elements.at(-1)?.id).toBe("logo");
            }

            const footerLines = doc.elements.filter(
              (e) => e.type === "text" && e.role === "footer",
            );
            expect(footerLines).toHaveLength(spec.footerLines.length);
            const cta = byId(doc, "cta");
            for (const line of footerLines) {
              /* The footer is utility copy under the message, never on it. */
              if (cta) {
                expect(line.y, label).toBeGreaterThanOrEqual(
                  cta.y + cta.height,
                );
              }
            }
          }
        }
      }
    },
    240_000,
  );
});

describe("documentFromSpec design rules", () => {
  it("is deterministic", async () => {
    const spec = specFor("quote-card", "4:5");
    const a = await build(spec, true, true);
    const b = await documentFromSpec({
      spec,
      palette: PALETTE,
      canvas: canvasFor("4:5"),
      image: IMAGE,
      logo: { asset: LOGO, aspect: LOGO_ASPECT },
      measurer: createRendererMeasurer({ fonts: await loadBrandFonts(null) }),
    });
    expect(b).toEqual(a);
  });

  it("keeps the headline at least 1.3x the subheadline at worst-case copy", async () => {
    for (const layout of LAYOUTS) {
      for (const ratio of RATIOS) {
        const doc = await build(
          specFor(layout, ratio, WORST_CASE),
          false,
          true,
        );
        const headline = byId(doc, "headline");
        const sub = byId(doc, "subheadline");
        if (headline?.type !== "text" || sub?.type !== "text") {
          throw new Error("missing copy");
        }
        expect(
          headline.fontSize / sub.fontSize,
          `${layout} ${ratio}`,
        ).toBeGreaterThanOrEqual(1.3);
      }
    }
  }, 120_000);

  it("guarantees readable white copy over a photograph", async () => {
    /* Black at the scrim's alpha over pure white, the worst photograph. */
    const scrimOverWhite = "#707070";
    for (const layout of [
      "hero-center",
      "quote-card",
      "stat-highlight",
    ] as const) {
      const doc = await build(specFor(layout, "4:5"), true, false);
      const headline = byId(doc, "headline");
      if (headline?.type !== "text") throw new Error("no headline");
      expect(headline.color).toBe("#FFFFFF");
      expect(contrastRatio("#FFFFFF", scrimOverWhite)).toBeGreaterThanOrEqual(
        4.5,
      );
      const ground = doc.elements.find(
        (e) => e.id === "scrim" || e.id === "card",
      );
      expect(ground, layout).toBeDefined();
    }
  });

  it("colours the footer for what is under it, not for whether a photo exists", async () => {
    for (const layout of ["split-left", "banner-bottom"] as const) {
      const doc = await build(specFor(layout, "4:5"), true, false);
      const footer = byId(doc, "footer-1");
      if (footer?.type !== "text") throw new Error("no footer");
      /* Both layouts put the footer on the flat background. */
      expect(
        contrastRatio(footer.color, PALETTE.background),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives the CTA label the most readable colour on the accent", async () => {
    const doc = await build(specFor("hero-center", "1:1"), false, false);
    const cta = byId(doc, "cta");
    if (cta?.type !== "button") throw new Error("no cta");
    expect(cta.fill).toBe(PALETTE.accent);
    expect(contrastRatio(cta.color, cta.fill)).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves a bar footer in a bar of its own", async () => {
    const doc = await build(
      { ...specFor("hero-center", "1:1"), footerStyle: "bar" },
      false,
      false,
    );
    const bar = byId(doc, "footer-bar");
    const line = byId(doc, "footer-1");
    if (!bar || !line) throw new Error("no bar");
    expect(bar.y + bar.height).toBe(doc.height);
    expect(line.y).toBeGreaterThanOrEqual(bar.y);
  });

  it("omits optional copy the spec does not have", async () => {
    const doc = await build(
      {
        ...specFor("stat-highlight", "1:1"),
        subheadline: undefined,
        cta: undefined,
        footerStyle: "none",
        footerLines: [],
      },
      false,
      false,
    );
    expect(doc.elements.map((e) => e.id)).not.toEqual(
      expect.arrayContaining(["subheadline"]),
    );
    expect(byId(doc, "cta")).toBeUndefined();
    expect(byId(doc, "footer-1")).toBeUndefined();
    expect(byId(doc, "headline")).toBeDefined();
  });
});
