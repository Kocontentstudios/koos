import { canvasFor } from "@/lib/design/canvas";
import type { DesignContext } from "@/lib/design/context";
import type { ImageFacts } from "@/lib/design/document/builders/ground";
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
import {
  measureSubject,
  SUBJECT_COVERED,
  type SubjectBox,
  type SubjectReport,
  subjectFromAlpha,
} from "@/lib/design/document/subject";
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
  /** The copy could not be set at the layout's type scale (from-spec.ts). */
  copyFault: string | null;
  /** No arrangement of the layout kept the copy off the subject or showed
   *  it whole (subject.ts). */
  subjectFault: string | null;
  /** The subject rule measured on the drawn document, when the image has a
   *  known subject. */
  subject: SubjectReport | null;
  logoUnplaced?: true;
}

export interface DirectionAssets {
  /** The photograph or plate, or null for a flat brand-colour design. */
  image: PlacedAsset | null;
  /** measureImage(image). Without it a cut-out is cropped like a photo and
   *  copy over a photo is veiled for the worst case. */
  imageFacts?: ImageFacts | null;
  /** The mark as drawn, with the loader's contrast reading. */
  logo: { placed: PlacedAsset; loaded: LoadedLogo } | null;
  /** Where the subject is in the image, from the plate check or the photo
   *  look. A cut-out's comes from its alpha when this is absent. */
  subject?: SubjectBox | null;
}

/** The subject box the builders keep clear: the one given, else a
 *  cut-out's visible pixels. */
export function subjectOf(assets: DirectionAssets): SubjectBox | null {
  if (!assets.image) return null;
  if (assets.subject) return assets.subject;
  return assets.imageFacts?.cutout ? subjectFromAlpha(assets.imageFacts) : null;
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
    heading: context.brand.brandFontUrl,
    body: context.brand.bodyFontUrl,
  };

  async function draw(
    spec: DesignSpec,
    logo: DirectionAssets["logo"],
  ): Promise<DocumentRender> {
    const built = await documentFromSpec({
      spec,
      palette: resolvePalette(spec.palette, context.brand),
      canvas: canvasFor(spec.aspectRatio),
      image: assets.image?.ref ?? null,
      imageFacts: assets.imageFacts ?? null,
      subject: assets.subject ?? null,
      logo: logo
        ? { asset: logo.placed.ref, aspect: logo.loaded.aspect }
        : null,
      measurer,
    });
    const doc = designDocumentSchema.parse(built.document);
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
      copyFault: built.copyFault,
      subjectFault: built.subjectFault,
      subject: measuredSubject(rendered.document, assets),
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

/** Whether `spec` keeps its copy off `subject`: the builders' own verdict
 *  (documentFromSpec's subjectFault), without drawing a pixel. */
export function subjectFaultChecker(
  context: DesignContext,
  assets: DirectionAssets,
  fonts: { fonts: LoadedFont[] },
): (spec: DesignSpec, subject: SubjectBox) => Promise<string | null> {
  const measurer = createRendererMeasurer({ fonts: fonts.fonts });
  return async (spec, subject) => {
    const logo = spec.logoPlacement === "none" ? null : assets.logo;
    const built = await documentFromSpec({
      spec,
      palette: resolvePalette(spec.palette, context.brand),
      canvas: canvasFor(spec.aspectRatio),
      image: assets.image?.ref ?? null,
      imageFacts: assets.imageFacts ?? null,
      subject,
      logo: logo
        ? { asset: logo.placed.ref, aspect: logo.loaded.aspect }
        : null,
      measurer,
    });
    /* A builder can settle for "cropped" while its fallback arrangement
       still lays a line over the subject (round-3 eval, conference); the
       measurement of the document is what decides. */
    const facts = assets.imageFacts;
    const measured = facts
      ? measureSubject(built.document, facts, subject)
      : null;
    if (measured && measured.overlaps.length > 0) return SUBJECT_COVERED;
    return built.subjectFault;
  };
}

/** The subject rule on a finished document, or null without a subject. */
export function measuredSubject(
  doc: DesignDocument,
  assets: DirectionAssets,
): SubjectReport | null {
  const subject = subjectOf(assets);
  const facts = assets.imageFacts;
  if (!subject || !facts) return null;
  return measureSubject(doc, facts, subject);
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
  copyHolds = () => true,
}: {
  id: string;
  spec: DesignSpec;
  context: DesignContext;
  assets: DirectionAssets;
  fonts: { fonts: LoadedFont[]; fault: string | null };
  outOfTime: () => boolean;
  onFirstRender?: () => void;
  /** Whether a corrected spec's copy may be drawn: within its limits and
   *  stating only the brief's facts. The judge rewrites copy too. */
  copyHolds?: (spec: DesignSpec) => boolean;
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
      corrected.layout === spec.layout &&
      drawsDifferently(spec, corrected) &&
      copyHolds(corrected),
    onFirstRender,
  });
}
