import { ImageResponse } from "next/og";
import { brandFontFaults, type LoadedFont, loadBrandFonts } from "./fonts";

/**
 * The one path from an element tree to PNG bytes, shared by the flex
 * composite and the layer document so both keep the same font fallback.
 */

export interface BrandFontUrls {
  brandFontUrl?: string | null;
  bodyFontUrl?: string | null;
}

/** Satori renders lazily inside the stream's start(), so a satori or resvg
 * failure surfaces at arrayBuffer(), not at construction — which is why every
 * caller has to await this to know whether it worked.
 *
 * An empty fonts array makes satori throw "No fonts are loaded"; omitting the
 * option entirely lets it fall back to its bundled face, so a font outage
 * degrades typography instead of failing the whole render. */
export async function rasterize(
  element: React.ReactElement,
  canvas: { width: number; height: number },
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

export interface FontFallbackDrawer {
  draw(
    element: React.ReactElement,
    canvas: { width: number; height: number },
  ): Promise<Uint8Array>;
  /** Why the brand's own face could not be used, or null. Read after the last
   *  draw: a face satori refuses is only discovered while drawing. */
  fault(): string | null;
  /** The faces the most recent successful draw used. */
  fonts(): LoadedFont[];
}

export function fontFallbackDrawer(
  fonts: LoadedFont[],
  brand: BrandFontUrls,
): FontFallbackDrawer {
  /* Two ways a brand face is lost, and both have to reach the user. This is
     the quiet one: the file was declined while being read, so the render below
     succeeds in the bundled faces and nothing about the result says the
     typeface was dropped. */
  const usedBrandFace = fonts.some((f) => f.fromBrand);
  let current = fonts;
  let fault: string | null =
    brandFontFaults({
      heading: brand.brandFontUrl,
      body: brand.bodyFontUrl,
    })[0] ?? null;

  return {
    fault: () => fault,
    fonts: () => current,
    async draw(element, canvas) {
      try {
        return await rasterize(element, canvas, current);
      } catch (error) {
        /* Structure cannot predict every face satori refuses: an unsupported
         GSUB lookup or a variable-font axis table parses perfectly and still
         throws here. So the brand's typeface is dropped and the design is
         rendered again rather than lost — a bad font must cost the typeface,
         never the design.

         Only when a brand face was actually loaded. Retrying a render that
         used the bundled faces would blame the font for a renderer fault, and
         the original error is rethrown if the retry fails for the same
         reason. */
        if (!usedBrandFace || current !== fonts) throw error;
        /* Deliberately not the exception text: satori's messages are
         internals ("Cannot read properties of undefined (reading '257')")
         that mean nothing to the person who uploaded a font. The structural
         reasons above are written for a reader; this one has no reader-facing
         detail to give, so it says only what is true. */
        fault = "the design renderer could not use it";
        try {
          const bundled = await loadBrandFonts(null);
          const bytes = await rasterize(element, canvas, bundled);
          current = bundled;
          return bytes;
        } catch {
          throw error;
        }
      }
    },
  };
}
