// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import { loadBrandFonts } from "@/lib/design/render/fonts";
import { rasterize } from "@/lib/design/render/rasterize";
import { decodePngRgba } from "@/lib/images/png-pixels";
import {
  IMAGE,
  LAYOUTS,
  LOGO,
  LOGO_ASPECT,
  PALETTE,
  RATIOS,
  specFor,
  WORST_CASE,
} from "./fixtures";
import { documentFromSpec } from "./from-spec";
import { createRendererMeasurer, type RendererMeasurer } from "./measure";
import { documentElement } from "./render";
import type { DesignDocument, DesignElement } from "./schema";

/**
 * Acceptance: no text overflow at worst-case copy (70/140/32 characters and
 * three 60-character footer lines) on every layout and aspect ratio.
 *
 * Checked against the pixels, not the layout. Each text element and button
 * is rendered alone, black on white, and the bounding box of its ink must sit
 * inside the element's box and inside the canvas. Then no two elements' ink
 * may touch, and none may reach under the logo. A box that is right on paper
 * but whose glyphs spill out of it fails here.
 */

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

let fonts: Awaited<ReturnType<typeof loadBrandFonts>>;
let measurer: RendererMeasurer;

beforeAll(async () => {
  fonts = await loadBrandFonts(null);
  measurer = createRendererMeasurer({ fonts });
});

function solo(doc: DesignDocument, element: DesignElement): DesignDocument {
  const black =
    element.type === "text"
      ? { ...element, color: "#000000" }
      : element.type === "button"
        ? { ...element, fill: "#FFFFFF", color: "#000000" }
        : element;
  return { ...doc, background: "#FFFFFF", elements: [black] };
}

async function inkOf(doc: DesignDocument): Promise<Box | null> {
  const png = decodePngRgba(
    await rasterize(
      documentElement(doc, {}),
      { width: doc.width, height: doc.height },
      fonts,
    ),
  );
  if (!png) throw new Error("render did not decode");
  let box: Box | null = null;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const at = (y * png.width + x) * 4;
      const darkest = Math.min(
        png.pixels[at],
        png.pixels[at + 1],
        png.pixels[at + 2],
      );
      if (darkest > 160) continue;
      box = box
        ? {
            left: Math.min(box.left, x),
            top: Math.min(box.top, y),
            right: Math.max(box.right, x + 1),
            bottom: Math.max(box.bottom, y + 1),
          }
        : { left: x, top: y, right: x + 1, bottom: y + 1 };
    }
  }
  return box;
}

function intersects(a: Box, b: Box): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}

/* Antialiasing can put a faint pixel one step past the edge. */
const TOLERANCE = 1;

/* Glyphs that reach furthest outside the line box: accented capitals above,
   descenders below, on every line whatever the wrap. The worst-case copy is
   plain English, whose last line can easily carry no descender at all, and
   that let an element sized to its bare layout box pass. */
const OVERSHOOT = {
  ...WORST_CASE,
  headline:
    "Ålgjy Éjpqy Ügjpy Ångjy Éjgqy Ögjpy Åjgqy Éygjp Ügpqj Åjypq Égjyq Öjpg",
  subheadline:
    "Ågjpy Égqjy Ügpjy Åjqgy Égypj Öjgqy Åpgjy Éjgyp Ügyqj Åqjgy Égjqp Öygjp Åjgpq Égqyj Ügjyp Åpyqg Éjgqy Ögpyj Ågqjp Éyjqg Ügqpj Åjpgq Éqgyj",
  cta: "Réservez Égjpqy Ågjpqy Ügjpq Éjq",
};
if (OVERSHOOT.headline.length !== 70 || OVERSHOOT.cta.length !== 32) {
  throw new Error("OVERSHOOT copy must sit at the schema limits");
}

const CASES = [
  { copy: WORST_CASE, image: null, name: "worst-case flat" },
  { copy: WORST_CASE, image: IMAGE, name: "worst-case photo" },
  { copy: OVERSHOOT, image: null, name: "overshooting glyphs" },
];

describe.each(LAYOUTS)("%s at worst-case copy", (layout) => {
  it.each(RATIOS)(
    "keeps every glyph inside its box and the canvas at %s",
    async (ratio) => {
      const checked = new Map<string, Box>();
      for (const { copy: words, image, name } of CASES) {
        const doc = await documentFromSpec({
          spec: specFor(layout, ratio, words),
          palette: PALETTE,
          canvas: canvasFor(ratio),
          image,
          logo: { asset: LOGO, aspect: LOGO_ASPECT },
          measurer,
        });
        const copy = doc.elements.filter(
          (e) => e.type === "text" || e.type === "button",
        );
        expect(copy.map((e) => e.id)).toEqual(
          expect.arrayContaining(["headline", "subheadline", "cta"]),
        );

        const inks: { id: string; ink: Box }[] = [];
        for (const element of copy) {
          /* Ink depends only on the element's own geometry and type, so an
             element identical to one already checked (most layouts place
             copy the same with and without a photo) is not drawn twice. */
          const key = JSON.stringify({ ...element, color: null, fill: null });
          const seen = checked.get(key);
          const ink = seen ?? (await inkOf(solo(doc, element)));
          if (ink) checked.set(key, ink);
          expect(ink, `${element.id} drew nothing`).not.toBeNull();
          if (!ink) continue;
          const label = `${layout} ${ratio} ${name} ${element.id}`;
          expect(ink.left, label).toBeGreaterThanOrEqual(element.x - TOLERANCE);
          expect(ink.top, label).toBeGreaterThanOrEqual(element.y - TOLERANCE);
          expect(ink.right, label).toBeLessThanOrEqual(
            element.x + element.width + TOLERANCE,
          );
          expect(ink.bottom, label).toBeLessThanOrEqual(
            element.y + element.height + TOLERANCE,
          );
          expect(ink.left, label).toBeGreaterThanOrEqual(0);
          expect(ink.top, label).toBeGreaterThanOrEqual(0);
          expect(ink.right, label).toBeLessThanOrEqual(doc.width);
          expect(ink.bottom, label).toBeLessThanOrEqual(doc.height);
          inks.push({ id: element.id, ink });
        }

        for (let i = 0; i < inks.length; i += 1) {
          for (let j = i + 1; j < inks.length; j += 1) {
            expect(
              intersects(inks[i].ink, inks[j].ink),
              `${layout} ${ratio}: ${inks[i].id} touches ${inks[j].id}`,
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
              `${layout} ${ratio}: ${id} runs under the logo`,
            ).toBe(false);
          }
        }
      }
    },
    180_000,
  );
});
