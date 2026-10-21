import { ImageResponse } from "next/og";
import {
  type BackingDecision,
  logoBackingFor,
  type MarkInk,
} from "@/lib/design/logo-contrast";
import { decodePngRgba, regionInk } from "@/lib/images/png-pixels";
import {
  type BrandFontUrls,
  brandFontFaults,
  type LoadedFont,
  loadBrandFonts,
} from "./fonts";

/**
 * The satori + resvg path every composite render goes through: the flex
 * layouts (composite.ts) and the layer documents (document/rasterize.tsx).
 * One copy, so the brand-font fallback and the logo measurement cannot drift
 * between the two renderers.
 */

type Canvas = { width: number; height: number };

export interface BrandRasterizer {
  /** Draws at the canvas the rasterizer was made for, or at `canvas`. */
  draw(element: React.ReactElement, canvas?: Canvas): Promise<Uint8Array>;
  /** Why the brand's own face was not used, or null. Read after drawing:
   *  a face satori refuses is only discovered by drawing with it. */
  brandFontFault(): string | null;
  /** The faces the most recent successful draw used. */
  fonts(): LoadedFont[];
}

export async function createBrandRasterizer(
  canvas: Canvas,
  brand: BrandFontUrls,
  /** Faces already loaded (and possibly already settled) by the caller. */
  preloaded?: LoadedFont[],
): Promise<BrandRasterizer> {
  const loaded = preloaded ?? (await loadBrandFonts(brand));
  let current = loaded;

  /* Two ways a brand face is lost, and both have to reach the user. This is
     the quiet one: the file was declined while being read, so the render below
     succeeds in the bundled faces and nothing about the result says the
     typeface was dropped. */
  const usedBrandFace = loaded.some((f) => f.fromBrand);
  let fault: string | null = brandFontFaults(brand)[0] ?? null;

  const draw = async (element: React.ReactElement, size: Canvas = canvas) => {
    try {
      return await rasterize(element, size, current);
    } catch (error) {
      /* Structure cannot predict every face satori refuses: an unsupported GSUB
       lookup or a variable-font axis table parses perfectly and still throws
       here. So the brand's typeface is dropped and the design is rendered
       again rather than lost: a bad font must cost the typeface, never the
       design.

       Only when a brand face was actually loaded, and only once. Retrying a
       render that used the bundled faces would blame the font for a renderer
       fault, and the original error is rethrown if the retry fails for the
       same reason. The bundled faces then stay in use, so a multi-pass render
       does not pay for the refused face on every pass. */
      if (!usedBrandFace || current !== loaded) throw error;
      /* Deliberately not the exception text: satori's messages are internals
       ("Cannot read properties of undefined (reading '257')") that mean
       nothing to the person who uploaded a font. The structural reasons above
       are written for a reader; this one has no reader-facing detail to give,
       so it says only what is true. */
      fault = "the design renderer could not use it";
      try {
        const bundled = await loadBrandFonts(null);
        const bytes = await rasterize(element, size, bundled);
        current = bundled;
        return bytes;
      } catch {
        throw error;
      }
    }
  };

  return { draw, brandFontFault: () => fault, fonts: () => current };
}

/**
 * What to put behind the mark, read off a render of the design WITHOUT it.
 *
 * The only honest reading of what sits under the logo is the finished
 * picture: scrims, panels and object-fit cover all change the pixels under
 * the corner, and measuring the plate alone once reported 5.04 where the
 * render was 1.53. An undecodable ground means no backing, never a guess.
 */
export function logoBackingOnGround(
  groundPng: Uint8Array,
  box: { left: number; top: number; width: number; height: number } | null,
  ink: MarkInk,
): BackingDecision {
  const ground = decodePngRgba(groundPng);
  return logoBackingFor({
    ink,
    ground:
      ground && box
        ? regionInk(ground, box)
        : { darkest: Number.NaN, lightest: Number.NaN },
  });
}

/** Satori renders lazily inside the stream's start(), so a satori or
 * rasteriser (sharp/librsvg) failure surfaces at arrayBuffer(), not at
 * construction — which is why every
 * caller has to await this to know whether it worked.
 *
 * An empty fonts array makes satori throw "No fonts are loaded"; omitting the
 * option entirely lets it fall back to its bundled face, so a font outage
 * degrades typography instead of failing the whole render. */
export async function rasterize(
  element: React.ReactElement,
  canvas: Canvas,
  fonts: LoadedFont[],
): Promise<Uint8Array> {
  const response = new ImageResponse(element, {
    width: canvas.width,
    height: canvas.height,
    ...(fonts.length > 0
      ? {
          fonts: fonts.map((f) => ({
            name: f.name,
            data: f.data,
            weight: f.weight,
            style: f.style,
          })),
        }
      : {}),
  });
  return new Uint8Array(await response.arrayBuffer());
}
