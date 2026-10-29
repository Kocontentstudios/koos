import { canvasFor } from "@/lib/design/canvas";
import type { DesignContext } from "@/lib/design/context";
import type { ImageFacts } from "@/lib/design/document/builders/ground";
import { documentFromSpec } from "@/lib/design/document/from-spec";
import { createRendererMeasurer } from "@/lib/design/document/measure";
import {
  type DocumentAsset,
  DocumentAssetError,
  rasterizeDocument,
} from "@/lib/design/document/rasterize";
import {
  type DesignDocument,
  type DesignElement,
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
import {
  EmojiBudgetError,
  RenderTimeoutError,
} from "@/lib/design/render/satori-pool";
import type { DesignSpec } from "@/lib/design/spec";
import { type Guarded, guardRender } from "../design-gate";
import { layoutCraftFaults } from "./craft";
import type { PlacedAsset } from "./imagery";
import type { LayoutVerdict, PhotoPlace } from "./subject-layout";

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
  /** People's heads in the image: each kept whole in a crop or left out. */
  heads?: readonly SubjectBox[];
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
      heads: assets.heads ?? [],
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
         it the mark was the cause; if not, the original error stands. A
         render refused for its emoji, an asset too large to draw, or one
         stopped at its time limit is none of the mark's doing, and drawing
         again without it would only blame the logo and repeat the cost. */
      if (!logo || isRenderRefusal(err)) throw err;
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

/** A render refused for what the document asks of the renderer, not for
 *  any one asset in it. */
export function isRenderRefusal(err: unknown): boolean {
  return (
    err instanceof EmojiBudgetError ||
    err instanceof DocumentAssetError ||
    err instanceof RenderTimeoutError
  );
}

/** What the user is told when a direction's render was refused, in their
 *  words, or null for any other failure. Trying again would fail the same
 *  way, so each says what to change. */
export function renderRefusalMessage(err: unknown): string | null {
  if (err instanceof EmojiBudgetError) {
    return `This design can't be drawn: ${err.message}, then try again.`;
  }
  if (err instanceof DocumentAssetError) {
    return err.reason === "too_large"
      ? "This design's image is too large to draw. Try a smaller image, or regenerate to make new imagery."
      : "This design's image could not be read. Try another image, or regenerate to make new imagery.";
  }
  return null;
}

/** Whether `spec` keeps its copy off `subject` and draws it cleanly: the
 *  builders' subject verdict, checked by measuring the built document, and
 *  its craft faults (craft.ts), without drawing a pixel. */
export function layoutJudge(
  context: DesignContext,
  assets: DirectionAssets,
  fonts: { fonts: LoadedFont[] },
): (spec: DesignSpec, subject: SubjectBox | null) => Promise<LayoutVerdict> {
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
      heads: assets.heads ?? [],
      logo: logo
        ? { asset: logo.placed.ref, aspect: logo.loaded.aspect }
        : null,
      measurer,
    });
    /* A builder can settle for "cropped" while its fallback arrangement
       still lays a line over the subject (round-3 eval, conference); the
       measurement of the document is what decides. */
    const craft = layoutCraftFaults(built.document, assets.imageFacts);
    const place = photoPlace(built.document);
    const facts = assets.imageFacts;
    const measured =
      facts && subject ? measureSubject(built.document, facts, subject) : null;
    if (measured && measured.overlaps.length > 0) {
      return { subjectFault: SUBJECT_COVERED, craft, place };
    }
    return {
      subjectFault: subject ? built.subjectFault : null,
      craft,
      place,
    };
  };
}

/**
 * Where a document draws its picture, in canvas shares, and how it stands
 * to the headline: behind it, above it, below it or beside it. Two designs
 * with the photo above the copy read as one shape wherever the frame sits
 * (round-4 live critic, fashion: two photo-over-copy cards).
 */
export function photoPlace(doc: {
  width: number;
  height: number;
  elements: readonly DesignElement[];
}): PhotoPlace | null {
  const image = doc.elements.find((e) => e.type === "image");
  if (!image) return null;
  const headline = doc.elements.find(
    (e) => e.type === "text" && e.role === "headline",
  );
  let arrangement: PhotoPlace["arrangement"] = "behind";
  if (headline) {
    const apartX =
      image.x + image.width <= headline.x ||
      image.x >= headline.x + headline.width;
    const apartY =
      image.y + image.height <= headline.y ||
      image.y >= headline.y + headline.height;
    if (apartY && !apartX) {
      arrangement = image.y < headline.y ? "above" : "below";
    } else if (apartX) {
      arrangement = "beside";
    }
  }
  return {
    box: {
      x: image.x / doc.width,
      y: image.y / doc.height,
      w: image.width / doc.width,
      h: image.height / doc.height,
    },
    arrangement,
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

/**
 * What the gate may do to a direction, beyond its pixel checks: a correction
 * must keep the layout the forcing rule settled, draw something different,
 * and keep copy that holds (copyHolds); a second render that draws copy over
 * copy, or lays copy on the box the layout kept clear, is refused by
 * measurement whatever the builder reported (round-3 code critic: a
 * correction reported only "cropped" while its headline sat on the
 * subject).
 */
export function directionGateRules({
  spec,
  assets,
  copyHolds,
  keepsSubjectClear,
}: {
  spec: DesignSpec;
  assets: DirectionAssets;
  copyHolds: (corrected: DesignSpec) => boolean | Promise<boolean>;
  keepsSubjectClear: SubjectBox | null;
}): {
  acceptCorrection: (corrected: DesignSpec) => Promise<boolean>;
  refuseSecond: (second: DocumentRender) => boolean;
} {
  return {
    /* The judge sees one direction and cannot see its sibling, so it may
       not move the layout the forcing rule settled; and a change the
       document does not draw (a plate prompt, the native prompt) would buy
       an identical second render. */
    acceptCorrection: async (corrected) =>
      corrected.layout === spec.layout &&
      drawsDifferently(spec, corrected) &&
      (await copyHolds(corrected)),
    refuseSecond: (second) => {
      if (layoutCraftFaults(second.document).hard) return true;
      if (!keepsSubjectClear || !assets.imageFacts) return false;
      const measured = measureSubject(
        second.document,
        assets.imageFacts,
        keepsSubjectClear,
      );
      return (measured?.overlaps.length ?? 0) > 0;
    },
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
  copyHolds = () => true,
  keepsSubjectClear = null,
}: {
  id: string;
  spec: DesignSpec;
  context: DesignContext;
  assets: DirectionAssets;
  fonts: { fonts: LoadedFont[]; fault: string | null };
  outOfTime: () => boolean;
  onFirstRender?: () => void;
  /** Whether a corrected spec's copy may be drawn: within its limits,
   *  stating only the brief's facts and losing none it stated. The judge
   *  rewrites copy too. */
  copyHolds?: (spec: DesignSpec) => boolean | Promise<boolean>;
  /** The box the chosen layout keeps clear. A corrected render that lays
   *  copy on it is refused by measurement, whatever the builder reported
   *  (round-3 code critic: a correction reported only "cropped" while its
   *  headline sat on the subject). */
  keepsSubjectClear?: SubjectBox | null;
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
    ...directionGateRules({
      spec,
      assets,
      copyHolds,
      keepsSubjectClear,
    }),
    onFirstRender,
  });
}
