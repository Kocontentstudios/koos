import { canvasFor } from "@/lib/design/canvas";
import type { DesignContext } from "@/lib/design/context";
import { documentFromSpec } from "@/lib/design/document/from-spec";
import { createRendererMeasurer } from "@/lib/design/document/measure";
import {
  type DocumentAsset,
  rasterizeDocument,
} from "@/lib/design/document/rasterize";
import {
  type DesignDocument,
  designDocumentSchema,
} from "@/lib/design/document/schema";
import { resolvePalette } from "@/lib/design/palette";
import type { LoadedFont } from "@/lib/design/render/fonts";
import {
  LOGO_UNDECODABLE_IN_RENDER,
  type LoadedLogo,
} from "@/lib/design/render/logo";
import type { DesignSpec } from "@/lib/design/spec";
import { type Guarded, guardRender } from "../design-gate";
import type { PlacedAsset } from "./imagery";

export interface DocumentRender {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** The document as drawn, logo backings included. */
  document: DesignDocument;
  brandFontFault: string | null;
  logoFault: string | null;
  logoUnplaced?: true;
}

export interface DirectionAssets {
  /** The photograph or plate, or null for a flat brand-colour design. */
  image: PlacedAsset | null;
  /** The mark as drawn, with the loader's contrast reading. */
  logo: { placed: PlacedAsset; loaded: LoadedLogo } | null;
}

/** The spec fields a document actually draws. A correction that changes
 *  none of them would render the same picture again. */
const DRAWN_FIELDS = [
  "headline",
  "subheadline",
  "cta",
  "footerStyle",
  "footerLines",
  "palette",
  "logoPlacement",
] as const satisfies readonly (keyof DesignSpec)[];

export function drawsDifferently(a: DesignSpec, b: DesignSpec): boolean {
  return DRAWN_FIELDS.some(
    (field) => JSON.stringify(a[field]) !== JSON.stringify(b[field]),
  );
}

/**
 * Spec to document to PNG, for one direction.
 *
 * The measurer is made once and shared by both attempts the gate may make, so
 * a correction re-measures only the copy that changed.
 */
export function documentRenderer(
  context: DesignContext,
  assets: DirectionAssets,
  fonts: { fonts: LoadedFont[]; fault: string | null },
): (spec: DesignSpec) => Promise<DocumentRender> {
  const measurer = createRendererMeasurer({ fonts: fonts.fonts });
  const brand = {
    brandFontUrl: context.brand.brandFontUrl,
    bodyFontUrl: context.brand.bodyFontUrl,
  };

  async function draw(
    spec: DesignSpec,
    logo: DirectionAssets["logo"],
  ): Promise<DocumentRender> {
    const doc = designDocumentSchema.parse(
      await documentFromSpec({
        spec,
        palette: resolvePalette(spec.palette, context.brand),
        canvas: canvasFor(spec.aspectRatio),
        image: assets.image?.ref ?? null,
        logo: logo
          ? { asset: logo.placed.ref, aspect: logo.loaded.aspect }
          : null,
        measurer,
      }),
    );
    const files: Record<string, DocumentAsset> = {};
    if (assets.image) files[assets.image.ref.key] = assets.image.asset;
    if (logo) files[logo.placed.ref.key] = logo.placed.asset;
    const rendered = await rasterizeDocument({
      doc,
      assets: files,
      brand,
      logoInk: logo
        ? {
            [logo.placed.ref.key]: {
              darkest: logo.loaded.darkest,
              lightest: logo.loaded.lightest,
            },
          }
        : {},
      fonts: fonts.fonts,
    });
    return {
      bytes: rendered.bytes,
      width: rendered.width,
      height: rendered.height,
      document: rendered.document,
      brandFontFault: fonts.fault ?? rendered.brandFontFault,
      logoFault: rendered.logoFault,
    };
  }

  return async (spec) => {
    const logo = spec.logoPlacement === "none" ? null : assets.logo;
    try {
      return await draw(spec, logo);
    } catch (err) {
      /* Same rule as the composite route: a mark satori cannot decode must
         cost the user a corner, not the design. If the design draws without
         it the mark was the cause; if not, the original error stands. */
      if (!logo) throw err;
      const bare = await draw(spec, null).catch(() => {
        throw err;
      });
      return {
        ...bare,
        logoFault: LOGO_UNDECODABLE_IN_RENDER,
        logoUnplaced: true as const,
      };
    }
  };
}

/** One direction through the shared pre-delivery gate (design-gate.ts). */
export function renderDirectionGuarded({
  id,
  spec,
  context,
  assets,
  fonts,
  outOfTime,
  onFirstRender,
}: {
  id: string;
  spec: DesignSpec;
  context: DesignContext;
  assets: DirectionAssets;
  fonts: { fonts: LoadedFont[]; fault: string | null };
  outOfTime: () => boolean;
  onFirstRender?: () => void;
}): Promise<Guarded<DocumentRender>> {
  return guardRender(documentRenderer(context, assets, fonts), spec, {
    renderer: "composite",
    id,
    context,
    hasLogo: Boolean(assets.logo),
    outOfTime,
    /* The plate is already painted and the document render is
       deterministic, so the same spec would only repeat the fault. */
    rerollHelps: false,
    /* The judge sees one direction and cannot see its sibling, so it may not
       move the layout the forcing rule settled; and a change the document
       does not draw (a plate prompt, the native prompt) would buy an
       identical second render. */
    acceptCorrection: (corrected) =>
      corrected.layout === spec.layout && drawsDifferently(spec, corrected),
    onFirstRender,
  });
}
