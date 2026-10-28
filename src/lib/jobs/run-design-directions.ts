import { randomUUID } from "node:crypto";
import { freemem } from "node:os";
import { inferCategory } from "@/lib/ai/design-training/infer-category";
import { getPlateAdapter } from "@/lib/ai/image";
import { buildMemoryBlock } from "@/lib/ai/memory";
import type { DirectionsImageSource } from "@/lib/ai/prompts/design-directions";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import {
  claimDirectionLayout,
  createDesignGeneration,
  getDesignGenerationById,
  listDirectionSet,
  recordUsageEvent,
  updateDesignGeneration,
} from "@/lib/db/queries";
import type { DesignContext } from "@/lib/design/context";
import {
  readRationale,
  storedRationale,
} from "@/lib/design/direction-rationale";
import { measureImage } from "@/lib/design/document/image-facts";
import { prepareDocumentFonts } from "@/lib/design/document/rasterize";
import {
  measureSubject,
  SUBJECT_COVERED,
  SUBJECT_CROPPED,
  type SubjectBox,
  subjectFromAlpha,
} from "@/lib/design/document/subject";
import {
  KoImageryDisabledError,
  koImageryEnabled,
} from "@/lib/design/ko-imagery-flag";
import { markIsTooThin } from "@/lib/design/logo-placement";
import { readImageDimensions } from "@/lib/design/png-dimensions";
import { lookAtPhoto, type PhotoLook } from "@/lib/design/quality/plate-check";
import type { DesignSpec } from "@/lib/design/spec";
import { cleanCutoutBytes } from "@/lib/images/cutout-edge";
import { STORAGE_PREFIXES, uploadObject } from "@/lib/storage";
import { loadDesignImage } from "@/lib/uploads/design-image";
import { mapWithConcurrency } from "./calendar-assembly";
import {
  recentLayoutsFor,
  respecForLayout,
  settleLogo,
} from "./design-logo-settle";
import {
  notifyBrandAssetFaults,
  notifyImageLeftOff,
  notifyLogoLeftOff,
} from "./design-notify";
import { draftDirections, type PriorDirection } from "./directions/brief";
import {
  brandSetting,
  contradictedDates,
  type DateContradiction,
  factsMissing,
} from "./directions/brief-facts";
import { checkClaims } from "./directions/claim-check";
import type { ImageState } from "./directions/claims";
import { planConcepts, regenerationConcept } from "./directions/concepts";
import { renderConcurrency } from "./directions/concurrency";
import { paletteForCutout } from "./directions/craft";
import {
  correctionCheck,
  drawnCopyOf,
  settleReasons,
} from "./directions/finalize";
import {
  briefNamesPeople,
  type PlacedAsset,
  type PlateCheck,
  paintPlate,
  storeDrawnMark,
} from "./directions/imagery";
import { settleDirectionLayout } from "./directions/layout-claim";
import { createStageReporter } from "./directions/progress";
import {
  type DirectionAssets,
  layoutJudge,
  photoPlace,
  renderDirectionGuarded,
  renderRefusalMessage,
} from "./directions/render";
import { currentSibling, designSpecOf } from "./directions/schema";
import {
  chooseLayout,
  LAYOUT_CRAFT_FAILED,
  type LayoutChoice,
  LayoutsHeldError,
  type PhotoPlace,
  SAME_SHAPE_AS_SIBLING,
  SUBJECT_FACE_ONLY,
  SUBJECT_UNKNOWN,
} from "./directions/subject-layout";
import type { JobRuntime } from "./run-generation";

export type DirectionsImage =
  | { source: "upload"; key: string }
  | { source: "ko" }
  /* No photo: every direction is laid out as text (round 8, with KO
     imagery behind FEATURE_KO_IMAGERY). */
  | { source: "none" };

export interface DirectionsRequest {
  image: DirectionsImage;
  /** A direction to replace: exactly one new direction is made, in a layout
   *  that neither it nor its sibling uses. */
  regenerateOf?: string | null;
}

/** Thrown when the direction being regenerated is gone, not this brand's, or
 *  not a direction. The route checks first; this covers a delete between
 *  request and job. */
export class RegenerateTargetError extends Error {
  constructor() {
    super("The design you asked to regenerate no longer exists.");
    this.name = "RegenerateTargetError";
  }
}

/** Every layout put the copy over the product. The direction fails with
 *  this, in the user's words, rather than shipping the overlap. */
export class SubjectCoveredError extends Error {
  constructor() {
    super(
      "The copy could not be kept off the product in any layout. Try a photo with more room around the product, or shorter copy.",
    );
    this.name = "SubjectCoveredError";
  }
}

/** The best free layout still cut the subject, or kept only a face clear
 *  of the copy. The direction is not delivered with that fault (round-5
 *  live critic: a portrait on 16:9 shipped cut at the mouth, its fault
 *  recorded and shown to no one). */
export class SubjectFaultError extends Error {
  constructor() {
    super(
      "The photo could not be shown whole, clear of the copy, in another layout at this size. Try another size, or a photo with more room around the subject.",
    );
    this.name = "SubjectFaultError";
  }
}

/** Faults of a chosen layout or a delivered document that are faults of
 *  the subject itself: what the client pays for, cut or covered. */
const SUBJECT_FAULTS: readonly string[] = [
  SUBJECT_CROPPED,
  SUBJECT_FACE_ONLY,
  SUBJECT_COVERED,
];

/** No layout could draw the copy without a headline smaller than the
 *  small print or copy drawn over copy. */
export class CopyDoesNotFitError extends Error {
  constructor() {
    super(
      "The copy did not fit cleanly in any layout. Try shorter copy or another size.",
    );
    this.name = "CopyDoesNotFitError";
  }
}

/** The model's headline for a direction could not be drawn, even after it
 *  was asked again, and code never writes one in its place (round-8 code
 *  critic, break 3). */
export class HeadlineNotWrittenError extends Error {
  constructor() {
    super(
      "We couldn't write a headline for this design that keeps to your brief. Regenerate it to try again, or add more detail to the brief.",
    );
    this.name = "HeadlineNotWrittenError";
  }
}

interface RegenerationTarget {
  set: string;
  slot: number;
  /** The direction being replaced and its live sibling, when there is one. */
  existing: PriorDirection[];
  /** The live sibling's photo key and where it draws it, so a regenerate
   *  of the same upload keeps apart from it as a pair does (round-5 code
   *  critic: a regenerate made one row, so the rule never applied). */
  sibling: { imageKey: string | null; place: PhotoPlace | null } | null;
}

/* The round-2 live run lost a finished direction to one TLS "bad record
   mac" on this upload, which the S3 client does not retry. The render is the
   expensive part and is already done, so one more attempt is cheap. */
async function storeDelivered(key: string, bytes: Uint8Array): Promise<void> {
  const put = () =>
    uploadObject({ key, body: bytes, contentType: "image/png" });
  try {
    await put();
  } catch (err) {
    console.error("design upload failed once; retrying", err);
    await put();
  }
}

function priorDirection(row: {
  spec: unknown;
  rationale: unknown;
}): PriorDirection | null {
  const spec = row.spec as Partial<DesignSpec> | null;
  if (!spec?.headline || !spec.layout) return null;
  return {
    title: readRationale(row.rationale)?.title || spec.headline,
    headline: spec.headline,
    subheadline: spec.subheadline,
    cta: spec.cta,
    backgroundPrompt: spec.backgroundPrompt ?? "",
    layout: spec.layout,
  };
}

async function regenerationTarget(
  brandId: string,
  generationId: string,
): Promise<RegenerationTarget> {
  const target = await getDesignGenerationById(generationId);
  if (!target || target.brandId !== brandId) throw new RegenerateTargetError();
  const rationale = readRationale(target.rationale);
  /* The route refuses a variant row (no set, so no slot to swap into); this
     holds the same line for any caller that skipped it. */
  if (!rationale?.set) throw new RegenerateTargetError();
  const sibling = currentSibling(
    await listDirectionSet(brandId, rationale.set),
    { id: target.id, set: rationale.set, slot: rationale.slot },
  );
  const siblingRow = sibling ? await getDesignGenerationById(sibling.id) : null;
  const siblingDoc = siblingRow?.document as
    | Parameters<typeof photoPlace>[0]
    | null
    | undefined;
  return {
    set: rationale.set,
    slot: rationale.slot,
    existing: [target, sibling]
      .map((row) => (row ? priorDirection(row) : null))
      .filter((d): d is PriorDirection => d !== null),
    sibling: siblingRow
      ? {
          imageKey: siblingRow.sourceImageKey ?? null,
          place: siblingDoc?.elements ? photoPlace(siblingDoc) : null,
        }
      : null,
  };
}

/**
 * The directions path (FEAT-033): two editable layer documents built on
 * contrasting concepts, or one replacement for a direction the user wants
 * again. Selected by the request's `image` field; see generateDesignWork.
 *
 * Order matters for cost and for what the user is left with on failure:
 *  1. The uploaded file is read and judged first, so an unusable image costs
 *     no model call and writes no row.
 *  2. One structured call writes every direction (directions/brief.ts).
 *  3. Rows are written before the slow work, as on the variant route, so
 *     provenance survives a crash.
 *  4. Imagery: the user's photograph as-is, or one stored plate per
 *     direction from the plate model.
 *  5. Each direction is rendered and passed through the pre-delivery gate,
 *     concurrently when memory allows.
 *
 * One quota unit per job however many directions it makes.
 */
export async function generateDirectionsWork(
  {
    context,
    userId,
    sessionId,
    request,
  }: {
    context: DesignContext;
    userId: string;
    sessionId?: string | null;
    request: DirectionsRequest;
  },
  runtime: JobRuntime,
): Promise<{ resultId?: string; result: unknown }> {
  const brandId = context.brand.id;
  const source: DirectionsImageSource = request.image.source;
  /* Refused before any row, model call or image call. */
  if (source === "ko" && !koImageryEnabled()) {
    throw new KoImageryDisabledError();
  }
  const regenerating = Boolean(request.regenerateOf);
  const count = regenerating ? 1 : 2;
  const stage = createStageReporter(runtime.reportProgress, count);
  stage(
    "brief",
    0,
    regenerating ? "Writing a new direction…" : "Writing two directions…",
  );

  const upload =
    request.image.source === "upload"
      ? {
          key: request.image.key,
          ...(await loadDesignImage(request.image.key, brandId)),
        }
      : null;
  const plateAdapter = source === "ko" ? getPlateAdapter() : null;
  if (source === "ko" && !plateAdapter) {
    throw new Error("Image generation is not configured.");
  }
  const target = request.regenerateOf
    ? await regenerationTarget(brandId, request.regenerateOf)
    : null;

  const category = inferCategory(context.briefText, context.designType);
  const [memorySummary, recent] = await Promise.all([
    buildMemoryBlock(brandId),
    recentLayoutsFor(brandId),
  ]);
  const brief = await draftDirections({
    context,
    imageSource: source,
    image: upload
      ? { bytes: new Uint8Array(upload.bytes), contentType: upload.contentType }
      : null,
    lenses: target ? [regenerationConcept(category)] : planConcepts(category),
    recentLayouts: recent,
    memorySummary,
    existing: target?.existing ?? [],
  });

  const settled = await Promise.all(
    brief.directions.map((d) => settleLogo(designSpecOf(d), context)),
  );
  const marks = await Promise.all(
    settled.map(async ({ logo }) =>
      logo
        ? { placed: await storeDrawnMark(brandId, logo), loaded: logo }
        : null,
    ),
  );

  const set = target?.set ?? randomUUID();
  /* Named as image_source is: a text-led row was once stored and costed as
     "upload" (round-8 code critic). */
  const imageProvider = plateAdapter?.id ?? (upload ? "upload" : "none");
  const rows = await Promise.all(
    brief.directions.map((direction, i) =>
      createDesignGeneration({
        brandId,
        userId,
        source: context.source,
        briefId: context.briefId,
        calendarItemId: context.calendarItemId,
        attachments: context.attachments,
        designType: context.designType,
        spec: settled[i].spec,
        renderer: "composite",
        provider: imageProvider,
        model: plateAdapter?.model ?? "none",
        status: "pending",
        rationale: storedRationale(direction, set, target?.slot ?? i),
        imageSource: source,
        sourceImageKey: upload?.key ?? null,
      }),
    ),
  );

  let imageCalls = 0;
  let images: (PlacedAsset | null)[];
  let imageStates: ImageState[];
  /* What a look at each direction's image found in it, for the reasons, and
     where its subject is, for the layout. */
  const descriptions: (string | undefined)[] = settled.map(() => undefined);
  const subjectBoxes: (SubjectBox | null)[][] = settled.map(() => []);
  const plateChecks: PlateCheck[] = [];
  const platesRejected: number[] = [];
  let photoLook: PhotoLook | null = null;
  if (upload) {
    const photo: PlacedAsset = {
      ref: { key: upload.key },
      asset: {
        bytes: new Uint8Array(upload.bytes),
        contentType: upload.contentType,
      },
    };
    images = settled.map(() => photo);
    imageStates = settled.map(() => (brief.imageSeen ? "seen" : "unverified"));
    photoLook = await lookAtPhoto(photo.asset.bytes);
    if (photoLook) {
      for (let i = 0; i < settled.length; i += 1) {
        descriptions[i] = photoLook.description;
      }
    }
  } else if (source === "none") {
    images = settled.map(() => null);
    imageStates = settled.map((): ImageState => "none");
  } else {
    let painted = 0;
    stage("imagery", 0, "Creating imagery…");
    const setting = brandSetting(brief.read.facts, [
      context.brandSummary.overview,
      context.brandSummary.businessType,
      context.brandSummary.offer,
      context.brandSummary.differentiators,
    ]);
    const plates = await Promise.all(
      settled.map(async ({ spec }, i) => {
        const { productName, productLook } = brief.directions[i];
        const plate = await paintPlate({
          adapter: plateAdapter as NonNullable<typeof plateAdapter>,
          spec,
          product: productName
            ? {
                name: productName,
                look: productLook,
                kind: brief.read.offering?.kind ?? "product",
              }
            : null,
          productUnchecked:
            !productName &&
            Boolean(brief.reports[i]?.modelProduct.name) &&
            brief.productSources[i] === "none",
          setting,
          namesPeople:
            brief.read.people.length > 0 || briefNamesPeople(context.briefText),
          brandId,
        });
        imageCalls += plate.imageCalls;
        painted += 1;
        stage("imagery", painted, `Created ${painted} of ${count} images…`);
        return plate;
      }),
    );
    images = plates.map((plate) => plate.placed);
    for (const plate of plates) {
      plateChecks.push(plate.check);
      platesRejected.push(plate.seen.length);
    }
    plates.forEach((plate, i) => {
      if (!plate.placed) return;
      /* A plate whose subject was not boxed is laid out as unknown, and
         that is recorded (chooseLayout), never as a plate with nothing in
         it to keep clear. */
      /* An object-free scene is a backdrop: there is no subject to keep
         the copy off, and treating the whole room as one left every
         layout covering it (round-6 eval: seven plates left off). */
      subjectBoxes[i] =
        plate.check === "scene" ? [] : [plate.look?.subject ?? null];
      if (plate.look) {
        descriptions[i] = [plate.look.seen, ...plate.look.items].join(", ");
      }
    });
    imageStates = plates.map((plate): ImageState => {
      if (!plate.placed) return "none";
      return plate.check === "passed" || plate.check === "passed-on-retry"
        ? "verified"
        : "unverified";
    });
  }

  const prepared = await prepareDocumentFonts(
    {
      heading: context.brand.brandFontUrl,
      body: context.brand.bodyFontUrl,
    },
    settled
      .flatMap(({ spec }) => [
        spec.headline,
        spec.subheadline,
        spec.cta,
        ...spec.footerLines,
      ])
      .filter(Boolean)
      .join(" "),
  );

  /* Measured once per distinct image: the upload path draws the same photo
     in both directions. A measurement that fails only costs the cut-out
     treatment and the measured veil, never the design. */
  const facts = new Map<PlacedAsset, ReturnType<typeof measureImage>>();
  for (const image of images) {
    if (image && !facts.has(image)) {
      facts.set(
        image,
        measureImage(image.asset).catch((err) => {
          console.error("design image could not be measured", err);
          return null;
        }),
      );
    }
  }
  if (upload && images[0]) {
    const measured = await facts.get(images[0]);
    /* A cut-out's subject is its visible pixels, which are exact; the look
       is only for a photograph, where the whole subject comes first and a
       person's head and shoulders second. */
    const boxes = measured?.cutout
      ? [subjectFromAlpha(measured)]
      : [photoLook?.subject ?? null, photoLook?.face ?? null];
    for (let i = 0; i < settled.length; i += 1) subjectBoxes[i] = boxes;
    /* Drawn on a coloured ground, a cut-out's baked shadow and white fringe
       show; its edge is feathered and decontaminated first (cutout-edge). */
    if (measured?.cutout) {
      images[0].asset = {
        ...images[0].asset,
        bytes: await cleanCutoutBytes(images[0].asset.bytes),
        contentType: "image/png",
      };
    }
  }

  const largestImage = Math.max(
    0,
    ...images.map((image) => {
      const size = image ? readImageDimensions(image.asset.bytes) : null;
      return size ? size.width * size.height : 0;
    }),
  );
  const concurrency = renderConcurrency({
    directions: count,
    freeBytes: freemem(),
    imagePixels: largestImage,
  });

  const succeeded: string[] = [];
  const failed: string[] = [];
  const brandFontFaults: string[] = prepared.fault ? [prepared.fault] : [];
  /* Per direction, so quality_faults counts directions carrying a fault, as
     docs/analytics.md defines it, not fault strings. */
  const faultsByRow = new Map<string, string[]>();
  const addFault = (id: string, fault: string) =>
    faultsByRow.set(id, [...(faultsByRow.get(id) ?? []), fault]);
  plateChecks.forEach((check, i) => {
    if (check === "failed") {
      addFault(
        rows[i].id,
        "the generated image did not show the product, so the design was drawn without one",
      );
    }
    if (check === "failed-lettering") {
      addFault(
        rows[i].id,
        "the generated image kept painting made-up writing on the product, so the design was drawn without one",
      );
    }
    if (check === "failed-people") {
      addFault(
        rows[i].id,
        "the generated image kept painting a face beside a person the brief names, so the design was drawn without one",
      );
    }
    if (check === "unavailable") {
      addFault(
        rows[i].id,
        "the image model returned no image that could be drawn, so the design was drawn without one",
      );
    }
  });
  let reasonsReplaced = 0;
  const layoutChoices: (LayoutChoice | null)[] = rows.map(() => null);
  /* The same facts the directions were covered with (draftDirections), so
     what was drawn is measured against what was promised: the brief's
     facts and the people it names. */
  const hardFacts = brief.coverFacts;
  /* What the reader saw in words not the brief's. Never drawn in, but a
     design that does not state one has lost it, and says so. */
  const unreadFacts = brief.read.unread;
  const correctionKeeps = correctionCheck({
    ledger: brief.checks.ledger,
    facts: hardFacts,
    offering: brief.read.offering?.phrase ?? "",
    checker: checkClaims,
    briefText: brief.checks.briefText,
    title: brief.checks.title,
    brand: context.brandSummary,
  });
  const factsByDirection: (number | null)[] = rows.map(() => null);
  const factsLost: { direction: number; fact: string; reason: string }[] = [];
  const datesContradicted: (DateContradiction & { direction: number })[] = [];
  const judgeVerdicts: string[] = [];
  const correctionsKept: string[] = [];
  const logoFaults: string[] = [];
  for (const { fault, logo } of settled) {
    if (fault) logoFaults.push(fault);
    if (logo && markIsTooThin(logo.aspect)) {
      logoFaults.push(
        "it is too long and thin to read at the size a corner allows — a stacked or compact version would place better",
      );
    }
  }
  for (const [i, mark] of marks.entries()) {
    if (mark && !mark.placed && settled[i].logo) {
      logoFaults.push("a copy of it could not be saved alongside the design");
    }
  }

  let layoutsWereHeld = false;
  const refusals: string[] = [];
  let subjectFaulted = 0;
  let headlinesLost = 0;
  const shippedHeadlines: (string | null)[] = brief.directions.map(() => null);
  let rendered = 0;
  let checked = 0;
  stage(
    "render",
    0,
    `Rendering ${count === 1 ? "the direction" : "both directions"}…`,
  );
  const reportRendered = () => {
    rendered += 1;
    stage("render", rendered, `Rendered ${rendered} of ${count}…`);
    if (rendered === count) stage("checks", checked, "Checking the designs…");
  };
  const reportChecked = () => {
    checked += 1;
    if (rendered === count) {
      stage("checks", checked, `Checked ${checked} of ${count}…`);
    }
  };

  /* On an upload both directions draw the same photo, and two layouts can
     still put it in the same place (round-4 live critic: cafe and fashion
     were one shape twice). The second waits for where the first put it
     and keeps apart from it; a few hundred milliseconds of choosing. */
  const sharesPhoto = Boolean(upload) && rows.length > 1;
  const siblingPlace =
    upload && target?.sibling?.imageKey === upload.key
      ? target.sibling.place
      : null;
  let placeFirst: (place: PhotoPlace | null) => void = () => {};
  const firstPlaced = new Promise<PhotoPlace | null>((resolve) => {
    placeFirst = resolve;
  });

  await mapWithConcurrency(rows, concurrency, async (row, i) => {
    let counted = false;
    const slot = target?.slot ?? i;
    try {
      if (brief.headlineLost[i]) throw new HeadlineNotWrittenError();
      const mark = marks[i];
      const image = images[i];
      let assets: DirectionAssets = {
        image,
        imageFacts: image ? await facts.get(image) : null,
        logo: mark?.placed
          ? { placed: mark.placed, loaded: mark.loaded }
          : null,
      };
      /* A mark that loaded but could not be stored is not on the document,
         so the spec must not keep its corner either. */
      const unmarked = (spec: DesignSpec) =>
        assets.logo ? spec : { ...spec, logoPlacement: "none" as const };
      const apartFrom = sharesPhoto && i > 0 ? await firstPlaced : siblingPlace;
      const relayout = (spec: DesignSpec, layout: DesignSpec["layout"]) =>
        unmarked(
          respecForLayout(spec, layout, {
            modelChoice: brief.directions[i].logoPlacement,
            hasLogo: Boolean(assets.logo),
          }),
        );
      const imageless = { ...assets, image: null, imageFacts: null };
      const choice = await settleDirectionLayout({
        self: { id: row.id, set, slot, replacing: request.regenerateOf },
        readSet: () => listDirectionSet(brandId, set),
        choose: async (held) => {
          const withImage = await chooseLayout({
            spec: unmarked(
              paletteForCutout(settled[i].spec, assets.imageFacts),
            ),
            held,
            subjects: assets.image ? subjectBoxes[i] : [],
            imageless: !assets.image,
            apartFrom,
            judge: layoutJudge(context, assets, prepared),
            relayout,
          });
          const subjectFaulted =
            withImage.fault === SUBJECT_COVERED ||
            withImage.faults.some((f) => SUBJECT_FAULTS.includes(f));
          /* A plate KO painted is not the client's photograph: one that no
             free layout shows whole and clear is left off and the design
             laid out as text, as for a plate that failed its check, rather
             than losing the direction. So is the client's own photo when
             its sibling already shows it and the one layout that fits is
             taken (Oluwaseyi's ruling, round 7: a 16:9 portrait delivered
             one direction of two). */
          /* Round 8: deterministic for every slot of a two-direction
             upload, the first included (round-7 live critic: slot 0 of a
             16:9 portrait failed while its sibling took the one layout
             that fits). And a second direction that would draw the photo
             in the same shape as its sibling is laid out as text, so the
             pair are two concepts, not one twice. */
          const pairOnUpload =
            Boolean(upload) && (rows.length > 1 || Boolean(target?.sibling));
          const sameAsSibling =
            Boolean(upload) && withImage.faults.includes(SAME_SHAPE_AS_SIBLING);
          if (
            !assets.image ||
            (!subjectFaulted && !sameAsSibling) ||
            (upload && !pairOnUpload)
          ) {
            return { ...withImage, plateLeftOff: false };
          }
          const asText = await chooseLayout({
            spec: unmarked(settled[i].spec),
            held,
            subjects: [],
            imageless: true,
            apartFrom: null,
            judge: layoutJudge(context, imageless, prepared),
            relayout,
          });
          return { ...asText, plateLeftOff: true };
        },
        claim: (spec, isFree) =>
          claimDirectionLayout({
            brandId,
            setId: set,
            rowId: row.id,
            spec,
            isFree,
          }),
      });
      layoutChoices[i] = choice;
      /* Where the first direction shows the photo, only when it will: a
         first direction refused for its subject shows it nowhere, and its
         sibling must not give the photo up on its account. */
      const refusedForSubject =
        choice.fault === SUBJECT_COVERED ||
        choice.fault === LAYOUT_CRAFT_FAILED ||
        choice.faults.some((f) => SUBJECT_FAULTS.includes(f));
      if (i === 0) placeFirst(refusedForSubject ? null : choice.place);
      if (choice.plateLeftOff) {
        assets = imageless;
        images[i] = null;
        imageStates[i] = "none";
        addFault(
          row.id,
          upload
            ? "the photo fits no free layout whole, or only in the shape the other direction shows it in, so this direction was laid out as text"
            : "no free layout showed the generated image whole and clear of the copy, so the design was laid out as text",
        );
      }
      /* No layout kept the copy off the product, or drew it cleanly: a
         design with the headline across the pastry, or under the small
         print, is not delivered. It fails with the reason, and without
         paying for a render that would only show the fault. */
      if (choice.fault === SUBJECT_COVERED) throw new SubjectCoveredError();
      if (choice.fault === LAYOUT_CRAFT_FAILED) throw new CopyDoesNotFitError();
      if (choice.faults.some((f) => SUBJECT_FAULTS.includes(f))) {
        throw new SubjectFaultError();
      }
      for (const fault of choice.faults) addFault(row.id, fault);
      const result = await renderDirectionGuarded({
        id: row.id,
        spec: choice.spec,
        context,
        assets: { ...assets, subject: choice.subject },
        fonts: prepared,
        copyHolds: (corrected) => correctionKeeps(choice.spec, corrected),
        keepsSubjectClear: choice.subject,
        outOfTime: () => runtime.shouldPause(),
        onFirstRender: () => {
          counted = true;
          reportRendered();
        },
      });
      /* Measured on what is delivered, against the whole subject, whatever
         box the layout kept clear: a face-only fallback is already a fault,
         and anything else on the subject is one too. */
      const onSubject =
        choice.wholeSubject && assets.imageFacts
          ? measureSubject(
              result.document,
              assets.imageFacts,
              choice.wholeSubject,
            )
          : null;
      /* The chosen layout cleared the subject; a delivered document that
         does not (a builder fallback, a kept correction) is refused the
         same way, before it is stored. */
      if (
        (onSubject && onSubject.overlaps.length > 0) ||
        (result.subjectFault && SUBJECT_FAULTS.includes(result.subjectFault))
      ) {
        throw new SubjectFaultError();
      }
      if (result.subjectFault) addFault(row.id, result.subjectFault);
      const key = `${STORAGE_PREFIXES.generated}/${brandId}/${randomUUID()}.png`;
      await storeDelivered(key, result.bytes);
      /* The reasons were written before the image was painted and before the
         gate could change the copy, so they are held again to what was
         actually delivered: the kept spec, the drawn document and what the
         image is known to show. */
      const direction = brief.directions[i];
      const drawnSpec = result.logoUnplaced
        ? { ...result.spec, logoPlacement: "none" as const }
        : result.spec;
      /* The copy as drawn, read off the document: the builders drop a footer
         line that repeats the copy above it, and a reason about that line
         would describe nothing (round-3 live critic). */
      const drawnCopy = drawnCopyOf(result.document.elements);
      const missing = factsMissing(hardFacts, drawnCopy);
      const unreadMissing = factsMissing(unreadFacts, drawnCopy);
      factsByDirection[i] =
        hardFacts.length +
        unreadFacts.length -
        missing.length -
        unreadMissing.length;
      const lost = missing.length + unreadMissing.length;
      /* A date the fact writer could not move off another day ships as
         drawn, and is counted against the design (round-15 code critic,
         finding 6). */
      const contradictions = contradictedDates(
        [...hardFacts, ...unreadFacts],
        drawnCopy,
      );
      for (const contradiction of contradictions) {
        datesContradicted.push({ direction: i, ...contradiction });
        addFault(
          row.id,
          `gives "${contradiction.run}" on another day than the brief's "${contradiction.fact}"`,
        );
      }
      if (lost > 0) {
        addFault(
          row.id,
          `leaves off ${lost} of the brief's ${hardFacts.length + unreadFacts.length} facts`,
        );
      }
      for (const fact of unreadMissing) {
        factsLost.push({
          direction: i,
          fact: fact.text,
          reason: "the reader returned it in words that are not the brief's",
        });
      }
      for (const fact of missing) {
        const recorded = brief.factCoverage.leftOff.find(
          (l) => l.direction === i && l.fact === fact.text,
        );
        factsLost.push(
          recorded ?? {
            direction: i,
            fact: fact.text,
            reason: "not on the design as delivered",
          },
        );
      }
      const settledReasons = settleReasons(direction.rationale, {
        factsMissing: lost,
        copy: drawnCopy,
        checks: brief.checks,
        product: direction.productName,
        image: assets.image ? imageStates[i] : "none",
        paintedScene: source === "ko" ? direction.backgroundPrompt : undefined,
        imageDescription: assets.image ? descriptions[i] : undefined,
        /* Measured against the whole subject or not at all: a reason
           that the product is drawn whole must not rest on a face box. */
        drawn: {
          document: result.document,
          subject: choice.wholeSubject ? (onSubject ?? result.subject) : null,
        },
      });
      if (settledReasons.dropped.length > 0) {
        reasonsReplaced += settledReasons.dropped.length;
        console.error("direction reasons not true of the delivered design", {
          id: row.id,
          dropped: settledReasons.dropped,
        });
      }
      await updateDesignGeneration(row.id, {
        imageKey: key,
        status: "succeeded",
        width: result.width,
        height: result.height,
        document: result.document,
        /* The spec column is what layout memory and every later surface
           read, so it records what was drawn: the kept correction, and no
           corner for a mark that never made it onto the design. */
        spec: drawnSpec,
        rationale: storedRationale(
          { title: direction.title, rationale: settledReasons.reasons },
          set,
          slot,
        ),
      });
      succeeded.push(row.id);
      shippedHeadlines[i] = drawnSpec.headline ?? null;
      if (result.brandFontFault && !prepared.fault) {
        brandFontFaults.push(result.brandFontFault);
      }
      if (result.logoFault) logoFaults.push(result.logoFault);
      const fault = [result.fault, result.copyFault].filter(Boolean).join("; ");
      if (fault) addFault(row.id, fault);
      if (result.correction) judgeVerdicts.push(result.correction);
      if (result.correctionKept) correctionsKept.push(row.id);
    } catch (err) {
      if (i === 0) placeFirst(null);
      console.error(`design direction ${row.id} failed`, err);
      if (err instanceof LayoutsHeldError) layoutsWereHeld = true;
      if (err instanceof SubjectFaultError) subjectFaulted += 1;
      if (err instanceof HeadlineNotWrittenError) headlinesLost += 1;
      const refusal = renderRefusalMessage(err);
      if (refusal) refusals.push(refusal);
      await updateDesignGeneration(row.id, {
        status: "failed",
        error: (
          refusal ?? (err instanceof Error ? err.message : "Unknown error")
        ).slice(0, 500),
      }).catch((writeErr) => {
        /* Left pending, the row holds its layout for PENDING_CLAIM_MS and a
           regenerate in that window is refused (round-8 code critic). */
        console.error(
          `design direction ${row.id} could not be marked failed`,
          writeErr,
        );
      });
      failed.push(row.id);
      if (!counted) reportRendered();
    } finally {
      reportChecked();
    }
  });

  await notifyBrandAssetFaults(userId, {
    font: brandFontFaults,
    logo: logoFaults,
  });
  /* A KO direction drawn with no image is a text-led design, not a broken
     one, but the user asked KO for imagery and is told plainly why it is
     not there and what to do. */
  const textLedRows = rows
    .map((row, i) => ({ row, i }))
    .filter(
      ({ row, i }) =>
        source === "ko" && !images[i] && succeeded.includes(row.id),
    );
  const textLed = textLedRows.length;
  /* Two different stories: the image model was down, or its plates were
     painted and turned down. Told as one, the bell blamed plates that were
     never made (round-5 code critic). */
  const imageModelDown = textLedRows.filter(
    ({ i }) => plateChecks[i] === "unavailable",
  ).length;
  if (textLed > 0) {
    await notifyImageLeftOff({
      userId,
      directions: textLed,
      of: count,
      subject: brief.directions.find((d) => d.productName)?.productName ?? "",
      cause: imageModelDown === textLed ? "unavailable" : "rejected",
    });
  }
  /* An upload direction laid out as text: counted and told, like a KO one
     (round-7 code critic: the two-directions path was untraced), with the
     cause it has. The photo is either shown by the other direction, or by
     none (round-8 code critic, J2). */
  const textLedUpload = rows.filter(
    (row, i) => upload && !images[i] && succeeded.includes(row.id),
  ).length;
  const photoShown =
    siblingPlace !== null ||
    rows.some((row, i) => upload && images[i] && succeeded.includes(row.id));
  if (textLedUpload > 0) {
    await notifyImageLeftOff({
      userId,
      directions: textLedUpload,
      of: count,
      subject: "",
      cause: photoShown ? "photo-taken" : "photo-fits-none",
    });
  }
  const leftOff = settled.find((s) => s.logoFree);
  if (leftOff && (context.brand.logoUrl || context.logoAssetUrls.length > 0)) {
    await notifyLogoLeftOff({
      userId,
      reason: leftOff.logoIsWhatWeAreDesigning
        ? `this is a ${context.designType} — the brand's current mark would be sitting on its own replacement`
        : `the brief asked for it: "${leftOff.spec.logoFreeQuote.trim()}"`,
    });
  }

  if (succeeded.length === 0) {
    /* When every direction failed the same honest way, say so: "try again"
       would only fail again on the same photograph or copy. */
    const allFailedWith = (fault: string) =>
      rows.every((_, i) => layoutChoices[i]?.fault === fault);
    throw new Error(
      allFailedWith(SUBJECT_COVERED)
        ? new SubjectCoveredError().message
        : allFailedWith(LAYOUT_CRAFT_FAILED)
          ? new CopyDoesNotFitError().message
          : layoutsWereHeld
            ? new LayoutsHeldError().message
            : subjectFaulted === rows.length
              ? new SubjectFaultError().message
              : headlinesLost === rows.length
                ? new HeadlineNotWrittenError().message
                : refusals.length === rows.length
                  ? (refusals[0] as string)
                  : "Design generation failed. Please try again.",
    );
  }

  /* Rows keep the order the directions were written in, so the results
     screen shows the "show" concept first whichever finished rendering
     first. */
  const generationIds = rows
    .map((row) => row.id)
    .filter((id) => succeeded.includes(id));
  const qualityFaults = generationIds.filter(
    (id) => (faultsByRow.get(id) ?? []).length > 0,
  ).length;

  /* Brief facts as delivered, per direction: the spec promises every fact
     on every direction, so the count reported is the worst direction's. */
  const deliveredFacts = rows
    .map((row, i) => (succeeded.includes(row.id) ? factsByDirection[i] : null))
    .filter((n): n is number => n !== null);
  const factsDelivered =
    deliveredFacts.length > 0 ? Math.min(...deliveredFacts) : 0;

  /* One usage row is one quota unit (countDesignGenerationsForWorkspace), so
     two directions cost what one generation always has. */
  await recordUsageEvent({
    userId,
    brandId,
    kind: "design_generated",
    metadata: {
      generationIds,
      failed: failed.length,
      /* The cost outcome FEAT-033 names: on an upload no image model runs,
         and this is where that is visible per generation. */
      renderers: rows.map(() => `composite:${imageProvider}`),
      imageCalls,
      imageSource: source,
      directions: generationIds.length,
      regenerateOf: request.regenerateOf ?? null,
      source: context.source,
      qualityFaults,
      judgeVerdicts: judgeVerdicts.length,
      correctionsKept: correctionsKept.length,
      layoutsForced: brief.layoutsForced,
      redrafted: brief.redrafted,
      headlineRewritten: brief.headlineRewritten,
      modelCalls: brief.modelCalls,
      /* Round-2 outcomes: how often the model had to be asked to rewrite,
         what still fell back, how many reasons were not true of the
         delivered design, and what the plate check concluded per plate. */
      fitAsked: brief.fit.asked,
      fitFixed: brief.fit.fixed,
      headlinesLost,
      /* Round 12: headlines refused, asked for once more, and what stood. */
      headlineRecovery: brief.headlineRecovery.map((r) => ({
        ...r,
        ships: shippedHeadlines[r.direction] ?? null,
      })),
      copyFallbacks: brief.reports.reduce(
        (n, r) => n + r.copyFallbacks.length,
        0,
      ),
      reasonsDropped:
        brief.reports.reduce((n, r) => n + r.reasonsDropped.length, 0) +
        reasonsReplaced,
      plateChecks,
      /* Round-3 outcomes: copy kept off the subject (and how), the brief's
         facts drawn, and where each plate's product name came from. */
      subjectKnown: subjectBoxes.map((boxes) => boxes.some(Boolean)),
      layoutsRelaid: layoutChoices.filter(
        (choice, i) => choice && choice.spec.layout !== settled[i].spec.layout,
      ).length,
      subjectFaults: layoutChoices.map((choice) => choice?.fault ?? null),
      briefFacts: hardFacts.length + unreadFacts.length,
      briefFactsDelivered: factsDelivered,
      briefFactsByDirection: factsByDirection,
      factsAdded: brief.factCoverage.added.length,
      factHeadlinesRewritten: brief.factCoverage.headlinesRewritten.length,
      factsLeftOff: factsLost,
      datesContradicted,
      productSources: brief.productSources,
      /* Round-4 outcomes: what the claim check read, and how many times
         each plate was turned down. */
      claimCheck: brief.claimCheck,
      platesRejected,
      /* Round-5 outcomes: the brief as read (and what the reader said
         that was not the brief's words), KO directions laid out as text
         because no plate passed, and directions whose subject was not
         found. */
      briefRead: {
        available: brief.read.available,
        offering: brief.read.offering?.kind ?? null,
        people: brief.read.people.length,
        dropped: brief.read.dropped,
        /* Round-6 outcomes: facts held back for not being the brief's
           words, and phone numbers found by code the reader missed. */
        unread: unreadFacts.map((f) => f.text),
        phonesAdded: brief.read.phonesAdded,
      },
      footerRepeatsDropped: brief.factCoverage.repeatsDropped,
      /* Round-6 outcome: footer items a model read as repeating the copy
         above in other words, and which code dropped. */
      footerParaphrases: brief.footerRepeats,
      textLed,
      textLedUpload,
      textLedImageModelDown: imageModelDown,
      subjectUnknown: layoutChoices.filter((choice) =>
        choice?.faults.includes(SUBJECT_UNKNOWN),
      ).length,
    },
  });

  const shared = {
    brand_id: brandId,
    session_id: sessionId ?? null,
    quality_faults: qualityFaults,
  };
  await captureServerEvent({
    distinctId: userId,
    event: "design_directions_generated",
    properties: {
      ...shared,
      source,
      directions: generationIds.length,
      regenerated: regenerating,
      image_calls: imageCalls,
      redrafted: brief.redrafted,
      layouts_forced: brief.layoutsForced,
      plates_rejected: platesRejected.filter((n) => n > 0).length,
      plates_failed: plateChecks.filter((c) => c.startsWith("failed")).length,
      text_led: textLed,
      text_led_upload: textLedUpload,
      headlines_lost: headlinesLost,
      headlines_recovered: brief.headlineRecovery.filter((r) => r.recovered)
        .length,
      text_led_image_model_down: imageModelDown,
    },
  });
  /* Kept for continuity: the quality-gate series on design_generated would
     otherwise read as a drop to zero the day the entry points switch over. */
  await captureServerEvent({
    distinctId: userId,
    event: "design_generated",
    properties: {
      ...shared,
      source: context.source,
      variants: generationIds.length,
      judge_verdicts: judgeVerdicts.length,
      corrections_kept: correctionsKept.length,
    },
  });

  return {
    resultId: generationIds[0],
    result: {
      generationIds,
      failed,
      imageSource: source,
      regenerateOf: request.regenerateOf ?? null,
    },
  };
}
