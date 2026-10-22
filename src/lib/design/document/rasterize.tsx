import { LOGO_NOT_LEGIBLE, type MarkInk } from "@/lib/design/logo-contrast";
import type { BrandFontUrls, LoadedFont } from "@/lib/design/render/fonts";
import {
  createBrandRasterizer,
  logoBackingOnGround,
} from "@/lib/design/render/rasterize";
import { type AssetSources, documentElement } from "./render";
import type { DesignDocument, LogoElement } from "./schema";

/**
 * Layer document to PNG, through the same rasterizer as the flex composite
 * (render/rasterize.ts): one brand-font fallback and one logo-backing
 * measurement, shared, so the two renderers cannot drift.
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
  const sources = toDataUris(assets);
  const rasterizer = await createBrandRasterizer(
    { width: doc.width, height: doc.height },
    brand,
    fonts,
  );
  const draw = (document: DesignDocument) =>
    rasterizer.draw(documentElement(document, sources));

  /* Two passes, as in the composite and for the same reason: the only honest
     reading of what sits under a mark is the finished picture with the mark
     left out. Every scrim, card and image crop is already in it. */
  let drawn = doc;
  let logoFault: string | null = null;
  const logos = measurableLogos(doc, sources, logoInk);
  if (logos.length > 0) {
    const ground = await draw({
      ...doc,
      elements: doc.elements.map((element) =>
        element.type === "logo" ? { ...element, hidden: true } : element,
      ),
    });
    const backings = new Map<string, string | null>();
    for (const logo of logos) {
      const decision = logoBackingOnGround(
        ground,
        { left: logo.x, top: logo.y, width: logo.width, height: logo.height },
        logoInk[logo.asset.key],
      );
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
    brandFontFault: rasterizer.brandFontFault(),
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
  const sampleCanvas = { width: 64, height: 16 };
  const rasterizer = await createBrandRasterizer(sampleCanvas, brand);
  const sample = sampleText.trim() || "Aa";
  await rasterizer.draw(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: sampleCanvas.width,
        height: sampleCanvas.height,
      }}
    >
      <div style={{ fontFamily: "Display", fontWeight: 700 }}>{sample}</div>
      <div style={{ fontFamily: "Body", fontWeight: 400 }}>{sample}</div>
      <div style={{ fontFamily: "Body", fontWeight: 600 }}>{sample}</div>
    </div>,
  );
  return { fonts: rasterizer.fonts(), fault: rasterizer.brandFontFault() };
}
