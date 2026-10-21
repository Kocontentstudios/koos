import {
  LOGO_NOT_LEGIBLE,
  logoBackingFor,
  type MarkInk,
} from "@/lib/design/logo-contrast";
import { type LoadedFont, loadBrandFonts } from "@/lib/design/render/fonts";
import {
  type BrandFontUrls,
  fontFallbackDrawer,
} from "@/lib/design/render/rasterize";
import { decodePngRgba, regionInk } from "@/lib/images/png-pixels";
import { type AssetSources, documentElement } from "./render";
import type { DesignDocument, LogoElement } from "./schema";

/**
 * Layer document to PNG, through the same next/og path as the flex composite
 * (render/rasterize.ts), so it keeps the brand-font fallback and the two-pass
 * logo backing measurement.
 */

export interface DocumentAsset {
  bytes: Uint8Array;
  contentType: string;
}

export interface RasterizeDocumentInput {
  doc: DesignDocument;
  /** Bytes for every asset key the document references, as read from
   *  storage. A key with no bytes is left out of the render. */
  assets: Record<string, DocumentAsset>;
  brand: BrandFontUrls;
  /** Darkest and lightest ink of each logo asset, from the logo loader's
   *  probe. A logo without a reading gets no backing, as in the composite. */
  logoInk?: Record<string, MarkInk>;
  /** The faces the document's text was fitted with (prepareDocumentFonts).
   *  Rendering in different faces than were measured would undo the fit. */
  fonts?: LoadedFont[];
}

export interface RasterizeDocumentResult {
  bytes: Uint8Array;
  contentType: "image/png";
  width: number;
  height: number;
  /** The document as drawn: logo backings chosen by the measurement are
   *  written back, so the editor shows the same plate the PNG has. */
  document: DesignDocument;
  logoFault: string | null;
  brandFontFault: string | null;
}

/** Satori resolves data URIs inline with no network I/O, so the lambda never
 *  races a signed URL's expiry or pays egress for its own bucket. */
function toDataUris(assets: Record<string, DocumentAsset>): AssetSources {
  return Object.fromEntries(
    Object.entries(assets).map(([key, asset]) => [
      key,
      `data:${asset.contentType};base64,${Buffer.from(asset.bytes).toString("base64")}`,
    ]),
  );
}

function measurableLogos(
  doc: DesignDocument,
  sources: AssetSources,
  inks: Record<string, MarkInk>,
): LogoElement[] {
  return doc.elements.filter(
    (element): element is LogoElement =>
      element.type === "logo" &&
      !element.hidden &&
      Boolean(sources[element.asset.key]) &&
      Boolean(inks[element.asset.key]),
  );
}

export async function rasterizeDocument({
  doc,
  assets,
  brand,
  logoInk = {},
  fonts,
}: RasterizeDocumentInput): Promise<RasterizeDocumentResult> {
  const canvas = { width: doc.width, height: doc.height };
  const sources = toDataUris(assets);
  const drawer = fontFallbackDrawer(
    fonts ??
      (await loadBrandFonts({
        heading: brand.brandFontUrl,
        body: brand.bodyFontUrl,
      })),
    brand,
  );
  const draw = (document: DesignDocument) =>
    drawer.draw(documentElement(document, sources), canvas);

  /* Two passes, as in the composite and for the same reason: the only honest
     reading of what sits under a mark is the finished picture with the mark
     left out. Every scrim, card and image crop is already in it. */
  let drawn = doc;
  let logoFault: string | null = null;
  const logos = measurableLogos(doc, sources, logoInk);
  if (logos.length > 0) {
    const withoutLogos: DesignDocument = {
      ...doc,
      elements: doc.elements.map((element) =>
        element.type === "logo" ? { ...element, hidden: true } : element,
      ),
    };
    const ground = decodePngRgba(await draw(withoutLogos));
    const backings = new Map<string, string | null>();
    for (const logo of logos) {
      const decision = logoBackingFor({
        ink: logoInk[logo.asset.key],
        ground: ground
          ? regionInk(ground, {
              left: logo.x,
              top: logo.y,
              width: logo.width,
              height: logo.height,
            })
          : { darkest: Number.NaN, lightest: Number.NaN },
      });
      backings.set(logo.id, decision.backing);
      /* Same rule as the composite: the best plate is applied even when it
         falls short, and the shortfall is reported, never swallowed. */
      if (!decision.legible) logoFault = LOGO_NOT_LEGIBLE;
    }
    drawn = {
      ...doc,
      elements: doc.elements.map((element) =>
        element.type === "logo" && backings.has(element.id)
          ? { ...element, backing: backings.get(element.id) ?? null }
          : element,
      ),
    };
  }

  const bytes = await draw(drawn);
  return {
    bytes,
    contentType: "image/png",
    width: doc.width,
    height: doc.height,
    document: drawn,
    logoFault,
    brandFontFault: drawer.fault(),
  };
}

/**
 * The faces to fit and draw a document in, settled before any text is
 * measured.
 *
 * The composite can discover a bad brand face mid-render and redraw in the
 * bundled ones, because its sizes do not depend on the face. A document's
 * sizes do: they were measured. So the face is tried once up front on the
 * document's own copy, and measurement and render then share whatever
 * survived.
 */
export async function prepareDocumentFonts(
  brand: BrandFontUrls,
  sampleText: string,
): Promise<{ fonts: LoadedFont[]; fault: string | null }> {
  const fonts = await loadBrandFonts({
    heading: brand.brandFontUrl,
    body: brand.bodyFontUrl,
  });
  const drawer = fontFallbackDrawer(fonts, brand);
  const sample = sampleText.trim() || "Aa";
  await drawer.draw(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 64,
        height: 16,
      }}
    >
      <div style={{ fontFamily: "Display", fontWeight: 700 }}>{sample}</div>
      <div style={{ fontFamily: "Body", fontWeight: 400 }}>{sample}</div>
      <div style={{ fontFamily: "Body", fontWeight: 600 }}>{sample}</div>
    </div>,
    { width: 64, height: 16 },
  );
  return { fonts: drawer.fonts(), fault: drawer.fault() };
}
