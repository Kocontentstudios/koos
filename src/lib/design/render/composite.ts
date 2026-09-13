import { ImageResponse } from "next/og";
import { canvasFor } from "@/lib/design/canvas";
import { LOGO_NOT_LEGIBLE, logoBackingFor } from "@/lib/design/logo-contrast";
import { logoBoxIn } from "@/lib/design/logo-placement";
import { type ResolvedPalette, resolvePalette } from "@/lib/design/palette";
import type { DesignSpec } from "@/lib/design/spec";
import { decodePngRgba, regionInk } from "@/lib/images/png-pixels";
import { brandFontFaults, type LoadedFont, loadBrandFonts } from "./fonts";
import { layoutElement } from "./layouts";

export interface CompositeInput {
  spec: DesignSpec;
  brand: {
    primaryColor?: string | null;
    secondaryColor?: string | null;
    additionalColors?: (string | null)[] | null;
    /** An uploaded face, used for headlines when it parses. */
    brandFontUrl?: string | null;
    bodyFontUrl?: string | null;
  };
  plate: { bytes: Uint8Array; contentType: string } | null;
  logo: {
    bytes: Uint8Array;
    contentType: string;
    /** Darkest and lightest ink in the mark, from the loader's probe. */
    darkest: number;
    lightest: number;
    /** Width/height of the mark, so its backing plate hugs it. */
    aspect?: number;
  } | null;
}

export interface CompositeResult {
  bytes: Uint8Array;
  contentType: "image/png";
  width: number;
  height: number;
  palette: ResolvedPalette;
  /** Set when the mark was placed but could not be made fully readable. */
  logoFault: string | null;
  /** Why the brand's own face could not be used, when the design had to be
   *  rendered in the bundled ones instead. Null on a normal render. Surfaced
   *  to the user: a silent fallback leaves them wondering why their typeface
   *  never appears. */
  brandFontFault: string | null;
}

/** Satori resolves data URIs inline with no network I/O, which is why the
 * plate and logo are inlined rather than passed as R2 URLs — no egress
 * round-trip and no signed-URL expiry race inside the lambda. */
function toDataUri(
  asset: { bytes: Uint8Array; contentType: string } | null,
): string | null {
  if (!asset) return null;
  return `data:${asset.contentType};base64,${Buffer.from(asset.bytes).toString("base64")}`;
}

export async function renderCompositeDesign({
  spec,
  brand,
  plate,
  logo,
}: CompositeInput): Promise<CompositeResult> {
  const canvas = canvasFor(spec.aspectRatio);
  const palette = resolvePalette(spec.palette, brand);
  const fonts = await loadBrandFonts({
    heading: brand.brandFontUrl,
    body: brand.bodyFontUrl,
  });

  const build = (logoBacking: string | null, withLogo: boolean) =>
    layoutElement({
      spec,
      palette,
      canvas,
      plateDataUri: toDataUri(plate),
      logoDataUri: withLogo ? toDataUri(logo) : null,
      logoBacking,
      logoAspect: logo?.aspect,
    });

  /* Two ways a brand face is lost, and both have to reach the user. This is
     the quiet one: the file was declined while being read, so the render below
     succeeds in the bundled faces and nothing about the result says the
     typeface was dropped. */
  const usedBrandFace = fonts.some((f) => f.fromBrand);
  let brandFontFault: string | null =
    brandFontFaults({
      heading: brand.brandFontUrl,
      body: brand.bodyFontUrl,
    })[0] ?? null;
  const draw = async (element: React.ReactElement) => {
    try {
      return await rasterize(element, canvas, fonts);
    } catch (error) {
      /* Structure cannot predict every face satori refuses: an unsupported GSUB
       lookup or a variable-font axis table parses perfectly and still throws
       here. So the brand's typeface is dropped and the design is rendered
       again rather than lost — a bad font must cost the typeface, never the
       design.

       Only when a brand face was actually loaded. Retrying a render that used
       the bundled faces would blame the font for a renderer fault, and the
       original error is rethrown if the retry fails for the same reason. */
      if (!usedBrandFace) throw error;
      /* Deliberately not the exception text: satori's messages are internals
       ("Cannot read properties of undefined (reading '257')") that mean
       nothing to the person who uploaded a font. The structural reasons above
       are written for a reader; this one has no reader-facing detail to give,
       so it says only what is true. */
      brandFontFault = "the design renderer could not use it";
      try {
        return await rasterize(element, canvas, await loadBrandFonts(null));
      } catch {
        throw error;
      }
    }
  };

  /* Two passes when a mark is being placed, because the only honest reading of
     what sits under it is the finished picture.

     Costed and accepted: ~133ms becomes ~400ms per composite variant at
     1080x1350, plus one 512px probe render per logo candidate. Against a 300s
     job budget where a single image call already takes 55-663s, that is
     noise — and the alternative is the measurement being wrong.

     Measuring the plate was wrong in three separate ways: the Scrim darkens it
     on three layouts, quote-card and stat-highlight lay a 42%-black panel over
     exactly where the mark goes, and on split-left and banner-bottom the plate
     covers part of the canvas and is drawn object-fit: cover, so the plate's
     own pixel grid is not the design's. A measurement that believed 5.04 while
     the render was 1.53 is worse than none — it reports success over an
     invisible logo. */
  let backing: string | null = null;
  let logoFault: string | null = null;
  if (logo && spec.logoPlacement !== "none") {
    const ground = decodePngRgba(await draw(build(null, false)));
    const box =
      ground &&
      logoBoxIn({
        placement: spec.logoPlacement,
        layout: spec.layout,
        width: ground.width,
        height: ground.height,
        aspect: logo.aspect,
      });
    const decision = logoBackingFor({
      ink: { darkest: logo.darkest, lightest: logo.lightest },
      ground:
        ground && box
          ? regionInk(ground, box)
          : { darkest: Number.NaN, lightest: Number.NaN },
    });
    backing = decision.backing;
    /* Some marks cannot be made fully readable on any single colour — a
       near-black glyph beside a mid-orange one tops out below the bar whatever
       sits behind it. The best available plate is still applied, because it is
       a large improvement on nothing, but a design carrying half a legible
       logo is exactly what this ticket is about and the user is told. */
    if (!decision.legible) {
      logoFault = LOGO_NOT_LEGIBLE;
    }
  }

  const bytes = await draw(build(backing, true));

  return {
    bytes,
    contentType: "image/png",
    width: canvas.width,
    height: canvas.height,
    palette,
    brandFontFault,
    logoFault,
  };
}

/** Satori renders lazily inside the stream's start(), so a satori or resvg
 * failure surfaces at arrayBuffer(), not at construction — which is why every
 * caller has to await this to know whether it worked.
 *
 * An empty fonts array makes satori throw "No fonts are loaded"; omitting the
 * option entirely lets it fall back to its bundled face, so a font outage
 * degrades typography instead of failing the whole render. */
async function rasterize(
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
