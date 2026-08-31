import { ImageResponse } from "next/og";
import { canvasFor } from "@/lib/design/canvas";
import { type ResolvedPalette, resolvePalette } from "@/lib/design/palette";
import type { DesignSpec } from "@/lib/design/spec";
import { loadBrandFonts } from "./fonts";
import { layoutElement } from "./layouts";

export interface CompositeInput {
  spec: DesignSpec;
  brand: {
    primaryColor?: string | null;
    secondaryColor?: string | null;
    additionalColors?: (string | null)[] | null;
    /** An uploaded face, used for headlines when it parses. */
    brandFontUrl?: string | null;
  };
  plate: { bytes: Uint8Array; contentType: string } | null;
  logo: { bytes: Uint8Array; contentType: string } | null;
}

export interface CompositeResult {
  bytes: Uint8Array;
  contentType: "image/png";
  width: number;
  height: number;
  palette: ResolvedPalette;
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
  const fonts = await loadBrandFonts(brand.brandFontUrl);

  const element = layoutElement({
    spec,
    palette,
    canvas,
    plateDataUri: toDataUri(plate),
    logoDataUri: toDataUri(logo),
  });

  // ImageResponse renders lazily inside the stream's start(), so a satori or
  // resvg failure surfaces here at arrayBuffer(), not at construction.
  // Passing an empty fonts array makes satori throw "No fonts are loaded";
  // omitting the option entirely lets it fall back to its bundled face, so a
  // font outage degrades typography instead of failing the whole render.
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

  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    bytes,
    contentType: "image/png",
    width: canvas.width,
    height: canvas.height,
    palette,
  };
}
