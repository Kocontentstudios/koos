import { randomUUID } from "node:crypto";
import { freemem } from "node:os";
import { getPlateAdapter } from "@/lib/ai/image";
import type { AspectRatio } from "@/lib/ai/image/types";
import { buildMemoryBlock } from "@/lib/ai/memory";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import {
  annotateSetUsage,
  createDesignGeneration,
  createDesignSet,
  createNotification,
  failAbandonedDesignJobs,
  failPendingGeneration,
  getDesignGenerationById,
  getDesignSet,
  listBilledSetGenerations,
  listSetFrames,
  recordUsageEvent,
  replaceDesignSetBeat,
  supersedeFrame,
  updateDesignGeneration,
  updateGenerationJob,
} from "@/lib/db/queries";
import type { designGenerations } from "@/lib/db/schema";
import type { AttachmentRef } from "@/lib/design/attachments";
import {
  type DesignContext,
  DesignContextError,
  resolveDesignContext,
} from "@/lib/design/context";
import type { ImageFacts } from "@/lib/design/document/builders/ground";
import { measureImage } from "@/lib/design/document/image-facts";
import { prepareDocumentFonts } from "@/lib/design/document/rasterize";
import type { DesignDocument } from "@/lib/design/document/schema";
import {
  measureSubject,
  SUBJECT_COVERED,
  type SubjectBox,
} from "@/lib/design/document/subject";
import {
  KoImageryDisabledError,
  koImageryEnabled,
} from "@/lib/design/ko-imagery-flag";
import { markIsTooThin } from "@/lib/design/logo-placement";
import {
  MultiFrameDisabledError,
  multiFrameEnabled,
} from "@/lib/design/multi-frame-flag";
import { readImageDimensions } from "@/lib/design/png-dimensions";
import { lookAtPhoto } from "@/lib/design/quality/plate-check";
import type {
  ApprovedOutline,
  FrameBeat,
  FrameEdits,
  PlannedSequence,
  RegenerateFrameJobResult,
  SequenceImageSource,
  SequenceJobResult,
  SequenceKind,
  SequenceProblem,
  SequenceRule,
} from "@/lib/design/sequence/contract";
import {
  PRESENTATION_ASPECT,
  sequenceKindOf,
} from "@/lib/design/sequence/contract";
import { frameSpec } from "@/lib/design/sequence/frame-spec";
import { frameRationale, liveFrames } from "@/lib/design/sequence/frames";
import {
  planSequence,
  SequenceShipRefusedError,
} from "@/lib/design/sequence/plan";
import { replanFrame } from "@/lib/design/sequence/replan";
import type { DesignSpec } from "@/lib/design/spec";
import { STORAGE_PREFIXES } from "@/lib/storage";
import { loadDesignImage } from "@/lib/uploads/design-image";
import { mapWithConcurrency } from "./calendar-assembly";
import {
  recentLayoutsFor,
  respecForLayout,
  settleLogo,
} from "./design-logo-settle";
import { notifyBrandAssetFaults, notifyLogoLeftOff } from "./design-notify";
import { readUploadedPhoto, type UploadedPhotoSubject } from "./design-photo";
import {
  type BriefFact,
  brandSetting,
  factStated,
} from "./directions/brief-facts";
import { renderConcurrency } from "./directions/concurrency";
import { paletteForCutout } from "./directions/craft";
import { copyNamesOffering, drawnCopyOf } from "./directions/finalize";
import {
  briefNamesPeople,
  type PlacedAsset,
  type PlateCheck,
  paintPlate,
  storeDrawnMark,
} from "./directions/imagery";
import {
  type DirectionAssets,
  layoutJudge,
  renderDirectionGuarded,
  renderRefusalMessage,
} from "./directions/render";
import {
  chooseLayout,
  LAYOUT_CRAFT_FAILED,
  type LayoutChoice,
} from "./directions/subject-layout";
import type { DirectionsImage } from "./run-design-directions";
import {
  CopyDoesNotFitError,
  HEADS_UNKNOWN_FAULT,
  plateCheckFault,
  SUBJECT_FAULTS,
  SubjectCoveredError,
  SubjectFaultError,
  storeDelivered,
} from "./run-design-directions";
import {
  executeGenerationJob,
  JobPausedError,
  type JobRuntime,
} from "./run-generation";
import {
  ABANDONED_SET_MS,
  isRegenerateFrameJobInput,
  isSequenceJobInput,
  SEQUENCE_SLICE_BUDGET_MS,
} from "./stale";

type GenerationRow = typeof designGenerations.$inferSelect;
type Palette = DesignSpec["palette"];

/* The plan's own promise to the brief. A set that breaks one of these is not
   the carousel asked for, and code may not rewrite the copy to fix it, so the
   job fails before a row is written or a frame is billed. The rest are
   recorded: the layout choice keeps neighbours apart whatever the plan said,
   and coverage is measured on what was drawn. */
const FATAL_RULES: readonly SequenceRule[] = [
  "count",
  "hook-first",
  "cta-last",
  "cta-only-last",
  "headline-repeat",
  "offering-unnamed",
];

/* Two renders at once, as for a pair of directions: a set's frames are drawn
   in waves so neighbours never choose at the same time (renderWaves). */
const MAX_FRAME_CONCURRENCY = 2;

export interface SequenceRequest {
  image: DirectionsImage;
  frames: number;
  /** The count the request or brief asked for before FRAME_BOUNDS clamped
   *  it into `frames`, so the user is told when the set is not that size. */
  asked?: number | null;
  /** The outline the user approved, validated by the route; `frames` is its
   *  points' length. Copy is written from it (planSequence). */
  approvedOutline?: ApprovedOutline;
}

/** What the context of a set was resolved from: kept on the job for a
 *  resumed slice and on the set for a regenerated frame. */
export interface SequenceContextRequest {
  briefId: string | null;
  calendarItemId: string | null;
  attachments: AttachmentRef[];
  freeform: string | null;
  aspectRatio: AspectRatio | null;
}

/** A sequence job's generation_jobs.input. */
export interface SequenceJobInput extends SequenceContextRequest {
  image: DirectionsImage;
  regenerateOf: null;
  /* The approved outline rides on the job so a slice that stops before
     the plan is checkpointed re-plans from what the user approved. */
  sequence: {
    frames: number;
    asked?: number | null;
    approvedOutline?: ApprovedOutline;
  };
}

/** A frame regenerate's generation_jobs.input. */
export interface RegenerateFrameJobInput {
  regenerateFrame: string;
  edits: FrameEdits | null;
}

/** What a sequence job parks in its checkpoint between slices. */
export interface SequenceCheckpoint {
  setId: string;
  plan: PlannedSequence;
  facts: BriefFact[];
  offering: string | null;
  planned: {
    modelCalls: number;
    repaired: boolean;
    problems: SequenceProblem[];
    /** Words the planner shipped that no source vouches for, as
     *  "frame N: words". Absent on checkpoints written before it existed. */
    invented?: string[];
    /** Brief facts the planner wrote into a footer itself. */
    factsDrawn?: string[];
    /** Frames, by their planned index, the planner dropped rather than
     *  ship a blocking fault. */
    framesDropped?: number[];
  };
  /** Frames that finished, delivered or failed, with what they carried, so a
   *  later slice neither renders them again nor loses their record. */
  frames: Record<string, FrameRecord>;
  startedAt: number;
  /** Set once the completing slice has billed the set and before it tells
   *  anyone: a slice resumed after this point returns the result without
   *  ringing the bell, writing the trace or sending the event again. */
  completed?: boolean;
}

interface FrameRecord {
  status: "succeeded" | "failed";
  faults: string[];
  imageCalls: number;
  textLed: boolean;
  plateCheck: PlateCheck | null;
}

export class SequencePlanError extends Error {
  constructor(
    kind: SequenceKind,
    readonly problems: SequenceProblem[],
  ) {
    super(planErrorMessage(kind, problems));
    this.name = "SequencePlanError";
  }
}

/* A refusal the owner can act on names the slide whose point to change
   in the outline; a set broken as a whole has no slide to name. */
function planErrorMessage(
  kind: SequenceKind,
  problems: readonly SequenceProblem[],
): string {
  const slides = [
    ...new Set(
      problems.flatMap((p) =>
        p.rule === "blocking-fault" && p.frame !== null ? [p.frame + 1] : [],
      ),
    ),
  ].sort((a, b) => a - b);
  if (slides.length === 0) {
    return `We couldn't plan this ${kind} as a set that keeps to your brief. Try again, or add more detail to the brief.`;
  }
  const listed =
    slides.length === 1
      ? `${slides[0]}`
      : `${slides.slice(0, -1).join(", ")} and ${slides.at(-1)}`;
  const noun = slides.length === 1 ? "slide" : "slides";
  const points = slides.length === 1 ? "point" : "points";
  return `We couldn't write ${noun} ${listed} of this ${kind} without repeating another slide or going beyond your brief. Change ${points} ${listed} in the outline, or try again.`;
}

/** The frame asked for is gone, not this brand's, or not a frame. */
export class FrameTargetError extends Error {
  constructor() {
    super("The frame you asked to regenerate no longer exists.");
    this.name = "FrameTargetError";
  }
}

/** The frame asked for is still being drawn by its set. */
export class FrameBusyError extends Error {
  constructor() {
    super("This frame is still being drawn. Try again once it has finished.");
    this.name = "FrameBusyError";
  }
}

/**
 * The row a regenerate of `requested` replaces: the one on show at its
 * index, so a superseded or stale id still redraws the frame the user sees.
 * Refused while that frame's own render has not finished, since the set job
 * would land its frame after the regenerate was paid for. Another regenerate
 * in flight at the index is not refused; whichever lands last is on show.
 */
export function frameToReplace(
  rows: readonly GenerationRow[],
  requested: Pick<GenerationRow, "status" | "frameIndex">,
): GenerationRow {
  const onShow = liveFrames(rows).find(
    (r) => r.frameIndex === requested.frameIndex,
  );
  if (!onShow) throw new FrameTargetError();
  if (requested.status === "pending" || onShow.status === "pending") {
    throw new FrameBusyError();
  }
  return onShow;
}

/** Everything a frame is drawn with that the whole set shares. */
interface FrameKit {
  context: DesignContext;
  brandId: string;
  source: SequenceImageSource;
  /** One palette for every frame (H2): the plan's, or the plan's turned for
   *  a cut-out, applied to all frames alike. */
  palette: Palette;
  logoPlacement: DesignSpec["logoPlacement"];
  logoFree: boolean;
  logoFreeQuote: string;
  mark: DirectionAssets["logo"];
  fonts: Awaited<ReturnType<typeof prepareDocumentFonts>>;
  photo: {
    placed: PlacedAsset;
    facts: ImageFacts | null;
    subject: UploadedPhotoSubject;
  } | null;
  plates: {
    adapter: NonNullable<ReturnType<typeof getPlateAdapter>>;
    setting: string | null;
    namesPeople: boolean;
    offering: string | null;
  } | null;
}

interface FrameOutcome {
  index: number;
  rowId: string;
  record: FrameRecord;
  layout: DesignSpec["layout"] | null;
  error: string | null;
  brandFontFault: string | null;
  logoFault: string | null;
}

/** A frame's spec on the set's shared system: palette, logo behaviour and
 *  the brief's no-logo answer are the set's, never the frame's own. */
function kitSpec(
  kit: FrameKit,
  plan: PlannedSequence,
  index: number,
): DesignSpec {
  const spec = {
    ...frameSpec(plan, index),
    palette: kit.palette,
    logoFree: kit.logoFree,
    logoFreeQuote: kit.logoFreeQuote,
  };
  return respecForLayout(spec, spec.layout, {
    modelChoice: kit.logoPlacement,
    hasLogo: Boolean(kit.mark),
  });
}

/** The image a frame draws, or null for a text-led frame. KO paints one
 *  plate per frame that shows the image; the client's photo is shared. */
async function frameImage(
  kit: FrameKit,
  beat: FrameBeat,
  spec: DesignSpec,
): Promise<{
  image: PlacedAsset | null;
  facts: ImageFacts | null;
  heads: DirectionAssets["heads"];
  subjects: (SubjectBox | null)[];
  imageCalls: number;
  plateCheck: PlateCheck | null;
  fault: string | null;
}> {
  const none = {
    image: null,
    facts: null,
    heads: [],
    subjects: [],
    imageCalls: 0,
    plateCheck: null,
    fault: null,
  };
  if (!beat.showsImage) return none;
  if (kit.photo) {
    return {
      ...none,
      image: kit.photo.placed,
      facts: kit.photo.facts,
      heads: kit.photo.subject.layoutHeads,
      subjects: kit.photo.subject.boxes,
      fault: kit.photo.subject.headsUnknown ? HEADS_UNKNOWN_FAULT : null,
    };
  }
  if (!kit.plates) return none;
  const plate = await paintPlate({
    adapter: kit.plates.adapter,
    spec,
    product: kit.plates.offering
      ? { name: kit.plates.offering, look: "" }
      : null,
    setting: kit.plates.setting,
    namesPeople: kit.plates.namesPeople,
    brandId: kit.brandId,
  });
  const fault = plateCheckFault(plate.check);
  if (!plate.placed) {
    return {
      ...none,
      imageCalls: plate.imageCalls,
      plateCheck: plate.check,
      fault,
    };
  }
  const facts = await measureImage(plate.placed.asset).catch((err) => {
    console.error("frame plate could not be measured", err);
    return null;
  });
  return {
    image: plate.placed,
    facts,
    heads: [],
    /* An object-free scene is a backdrop with no subject to keep clear. */
    subjects: plate.check === "scene" ? [] : [plate.look?.subject ?? null],
    imageCalls: plate.imageCalls,
    plateCheck: plate.check,
    fault,
  };
}

/* What a judge correction may not touch on a frame: the set's palette and
   footer system (H2), and copy the plan was held to or the user typed
   (H3, H9). The layout is already held by directionGateRules. */
const FRAME_FIXED_FIELDS = [
  "headline",
  "subheadline",
  "cta",
  "footerStyle",
  "footerLines",
  "palette",
] as const satisfies readonly (keyof DesignSpec)[];

/**
 * Whether a frame may take the judge's corrected spec. What is left to it is
 * where the mark sits, the fix for the one fault it corrects on a real design
 * (an unreadable logo). The corner already follows each frame's layout
 * (respecForLayout), so moving it stays within the set's logo behaviour; a
 * correction that drops the mark does not.
 */
export function frameCorrectionKeeps(
  spec: DesignSpec,
  corrected: DesignSpec,
): boolean {
  const fixedHeld = FRAME_FIXED_FIELDS.every(
    (field) => JSON.stringify(spec[field]) === JSON.stringify(corrected[field]),
  );
  const markKept =
    corrected.logoPlacement !== "none" || spec.logoPlacement === "none";
  return fixedHeld && markKept;
}

const isSubjectFault = (choice: LayoutChoice) =>
  choice.fault === SUBJECT_COVERED ||
  choice.faults.some((f) => SUBJECT_FAULTS.includes(f));

/**
 * One frame, from its image to a delivered row: the layout is chosen apart
 * from the layouts its neighbours hold, rendered through the directions
 * gate and stored. A frame that fails marks its row failed and the set goes
 * on without it.
 */
async function renderFrame(
  kit: FrameKit,
  {
    rowId,
    index,
    beat,
    spec,
    held,
    outOfTime,
  }: {
    rowId: string;
    index: number;
    beat: FrameBeat;
    spec: DesignSpec;
    held: string[];
    outOfTime: () => boolean;
  },
): Promise<FrameOutcome> {
  const faults: string[] = [];
  let imageCalls = 0;
  let plateCheck: PlateCheck | null = null;
  let textLed = !beat.showsImage;
  const outcome = (
    status: FrameRecord["status"],
    extra: Partial<FrameOutcome> = {},
  ): FrameOutcome => ({
    index,
    rowId,
    record: { status, faults, imageCalls, textLed, plateCheck },
    layout: null,
    error: null,
    brandFontFault: null,
    logoFault: null,
    ...extra,
  });
  try {
    const drawn = await frameImage(kit, beat, spec);
    imageCalls = drawn.imageCalls;
    plateCheck = drawn.plateCheck;
    if (drawn.fault) faults.push(drawn.fault);
    let assets: DirectionAssets = {
      image: drawn.image,
      imageFacts: drawn.facts,
      heads: drawn.image ? drawn.heads : [],
      logo: kit.mark,
    };
    textLed = !assets.image;
    const relayout = (s: DesignSpec, layout: DesignSpec["layout"]) =>
      respecForLayout(s, layout, {
        modelChoice: kit.logoPlacement,
        hasLogo: Boolean(kit.mark),
      });
    const choose = (a: DirectionAssets, subjects: (SubjectBox | null)[]) =>
      chooseLayout({
        spec,
        held,
        subjects: a.image ? subjects : [],
        imageless: !a.image,
        judge: layoutJudge(kit.context, a, kit.fonts),
        relayout,
      });
    let choice = await choose(assets, drawn.subjects);
    /* Another frame of the set shows the image; one that cannot show it
       whole and clear is laid out as text rather than lost, as a direction
       on a shared photo is (Oluwaseyi's ruling, round 7). */
    if (assets.image && isSubjectFault(choice)) {
      assets = { ...assets, image: null, imageFacts: null, heads: [] };
      choice = await choose(assets, []);
      textLed = true;
      faults.push(
        kit.source === "upload"
          ? "the photo fits no free layout whole on this frame, so it was laid out as text"
          : "no free layout showed the generated image whole and clear of the copy, so this frame was laid out as text",
      );
    }
    if (choice.fault === SUBJECT_COVERED) throw new SubjectCoveredError();
    if (choice.fault === LAYOUT_CRAFT_FAILED) throw new CopyDoesNotFitError();
    if (isSubjectFault(choice)) throw new SubjectFaultError();
    faults.push(...choice.faults);
    const result = await renderDirectionGuarded({
      id: rowId,
      spec: choice.spec,
      context: kit.context,
      assets: { ...assets, subject: choice.subject },
      fonts: kit.fonts,
      keepsSubjectClear: choice.subject,
      copyHolds: (corrected) => frameCorrectionKeeps(choice.spec, corrected),
      outOfTime,
    });
    const onSubject =
      choice.wholeSubject && assets.imageFacts
        ? measureSubject(
            result.document,
            assets.imageFacts,
            choice.wholeSubject,
            assets.heads ?? [],
          )
        : null;
    if (
      (onSubject && onSubject.overlaps.length > 0) ||
      (result.subjectFault && SUBJECT_FAULTS.includes(result.subjectFault))
    ) {
      throw new SubjectFaultError();
    }
    if (result.subjectFault) faults.push(result.subjectFault);
    const fault = [result.fault, result.copyFault].filter(Boolean).join("; ");
    if (fault) faults.push(fault);
    const key = `${STORAGE_PREFIXES.generated}/${kit.brandId}/${randomUUID()}.png`;
    await storeDelivered(key, result.bytes);
    const drawnSpec = result.logoUnplaced
      ? { ...result.spec, logoPlacement: "none" as const }
      : result.spec;
    await updateDesignGeneration(rowId, {
      imageKey: key,
      status: "succeeded",
      width: result.width,
      height: result.height,
      document: result.document,
      spec: drawnSpec,
      rationale: frameRationale(beat),
    });
    return outcome("succeeded", {
      layout: drawnSpec.layout,
      brandFontFault: result.brandFontFault,
      logoFault: result.logoFault,
    });
  } catch (err) {
    console.error(`design frame ${rowId} failed`, err);
    const message = (
      renderRefusalMessage(err) ??
      (err instanceof Error ? err.message : "Unknown error")
    ).slice(0, 500);
    await updateDesignGeneration(rowId, {
      status: "failed",
      error: message,
    }).catch((writeErr) => {
      console.error(
        `design frame ${rowId} could not be marked failed`,
        writeErr,
      );
    });
    return outcome("failed", { error: message });
  }
}

/**
 * Frames to draw this slice, grouped so no two in a group are neighbours:
 * even indexes, then odd. A frame drawn in the second group holds the
 * layouts its neighbours were actually drawn in, so two neighbours never
 * share a layout however the first group relaid (H4).
 */
export function renderWaves(pending: readonly number[]): number[][] {
  const even = pending.filter((i) => i % 2 === 0);
  const odd = pending.filter((i) => i % 2 === 1);
  return [even, odd].filter((wave) => wave.length > 0);
}

/** The layouts frame `index` may not take: its neighbours' drawn layouts,
 *  or, for a neighbour not drawn yet, the layout the plan gave it. */
export function heldByNeighbours(
  index: number,
  drawn: ReadonlyMap<number, string>,
  planned: readonly { layout: string }[],
): string[] {
  return [index - 1, index + 1]
    .filter((n) => n >= 0 && n < planned.length)
    .map((n) => drawn.get(n) ?? planned[n].layout)
    .filter((layout, i, all) => all.indexOf(layout) === i);
}

async function loadUploadKit(
  key: string,
  brandId: string,
): Promise<FrameKit["photo"]> {
  const upload = await loadDesignImage(key, brandId);
  const placed: PlacedAsset = {
    ref: { key },
    asset: {
      bytes: new Uint8Array(upload.bytes),
      contentType: upload.contentType,
    },
  };
  const [look, facts] = await Promise.all([
    lookAtPhoto(placed.asset.bytes),
    measureImage(placed.asset).catch((err) => {
      console.error("design image could not be measured", err);
      return null;
    }),
  ]);
  const subject = await readUploadedPhoto(placed, facts, look);
  return { placed, facts, subject };
}

/** The shared kit for a set: logo, mark, fonts and image, settled once. */
async function buildKit({
  context,
  plan,
  source,
  uploadKey,
  facts,
  offering,
  palette,
}: {
  context: DesignContext;
  plan: PlannedSequence;
  source: SequenceImageSource;
  uploadKey: string | null;
  facts: readonly BriefFact[];
  offering: string | null;
  /** The palette the set was already drawn in, for a regenerated frame. */
  palette?: Palette;
}): Promise<{
  kit: FrameKit;
  logoFault: string | null;
  logoIsWhatWeAreDesigning: boolean;
}> {
  const brandId = context.brand.id;
  const photo =
    source === "upload" && uploadKey
      ? await loadUploadKit(uploadKey, brandId)
      : null;
  const plateAdapter = source === "ko" ? getPlateAdapter() : null;
  if (source === "ko" && !plateAdapter) {
    throw new Error("Image generation is not configured.");
  }
  /* A cut-out's pale rim on a dark ground is turned once for the set, so
     every frame keeps the one palette rather than the frames with the
     photo flipping alone. */
  const setPalette =
    palette ??
    paletteForCutout({ palette: plan.palette }, photo?.facts).palette;
  const settled = await settleLogo(
    { ...frameSpec(plan, 0), palette: setPalette },
    context,
  );
  const placed = settled.logo
    ? await storeDrawnMark(brandId, settled.logo)
    : null;
  const mark = placed && settled.logo ? { placed, loaded: settled.logo } : null;
  const copy = plan.frames
    .flatMap((b) => [b.headline, b.subheadline, b.cta, ...b.footerLines])
    .filter(Boolean)
    .join(" ");
  const fonts = await prepareDocumentFonts(
    { heading: context.brand.brandFontUrl, body: context.brand.bodyFontUrl },
    copy,
  );
  const logoFaults = [
    settled.fault,
    settled.logo && markIsTooThin(settled.logo.aspect)
      ? "it is too long and thin to read at the size a corner allows — a stacked or compact version would place better"
      : null,
    settled.logo && !placed
      ? "a copy of it could not be saved alongside the design"
      : null,
  ].filter((f): f is string => Boolean(f));
  return {
    kit: {
      context,
      brandId,
      source,
      palette: setPalette,
      logoPlacement: plan.logoPlacement,
      logoFree: settled.spec.logoFree,
      logoFreeQuote: settled.spec.logoFreeQuote,
      mark,
      fonts,
      photo,
      plates: plateAdapter
        ? {
            adapter: plateAdapter,
            setting: brandSetting(facts, [
              context.brandSummary.overview,
              context.brandSummary.businessType,
              context.brandSummary.offer,
              context.brandSummary.differentiators,
            ]),
            namesPeople: briefNamesPeople(context.briefText),
            offering,
          }
        : null,
    },
    logoFault: logoFaults.join("; ") || null,
    logoIsWhatWeAreDesigning: settled.logoIsWhatWeAreDesigning,
  };
}

function drawnCopyOfRow(row: Pick<GenerationRow, "document">) {
  const doc = row.document as DesignDocument | null;
  return drawnCopyOf(doc?.elements ?? []);
}

/** The brief's facts no delivered frame states, read off what was drawn:
 *  a set covers a fact when any one of its frames does (H5). */
export function setFactsMissing(
  facts: readonly BriefFact[],
  drawn: readonly ReturnType<typeof drawnCopyOf>[],
): BriefFact[] {
  return facts.filter((fact) => !drawn.some((copy) => factStated(fact, copy)));
}

/** Why frames planned to show the image were laid out as text, in the words
 *  notifyImageLeftOff uses for a direction, so the bell reads the same. */
export type FramesTextLedCause = "photo-fits-none" | "unavailable" | "rejected";

export function framesTextLedMessage({
  kind,
  frames,
  of,
  cause,
  subject,
}: {
  kind: SequenceKind;
  frames: number;
  of: number;
  cause: FramesTextLedCause;
  subject: string | null;
}): string {
  const which =
    frames === 1
      ? `One frame of this ${of}-frame ${kind} was`
      : `${frames} frames of this ${of}-frame ${kind} were`;
  const them = frames === 1 ? "it" : "them";
  if (cause === "photo-fits-none") {
    return `${which} laid out with words only: your photo couldn't be shown whole and clear of the words on ${them} at this size. Regenerate ${them} to try another layout, or upload a photo with more room around the subject.`;
  }
  const why =
    cause === "unavailable"
      ? "KO's image service didn't return an image just now, so none could be used"
      : `the images KO made${subject ? ` of the ${subject}` : ""} couldn't be used: they showed the wrong thing, painted made-up writing or a face, or left no room to show the subject whole`;
  return `${which} laid out with words only: ${why}. Regenerate ${them} to try new imagery, or upload your own photo.`;
}

async function notifyFramesTextLed(userId: string, message: string) {
  await createNotification({
    userId,
    type: "system",
    payload: { message },
  }).catch((err) => {
    console.error("frame imagery notification failed", err);
  });
}

/**
 * Why a set is not the size asked for, or null when it is: FRAME_BOUNDS
 * holds a carousel or deck to what reads as one, and a brief asking for
 * twelve slides should not find ten without being told.
 */
export function frameCountNotice(
  kind: SequenceKind,
  frames: number,
  asked: number | null | undefined,
): string | null {
  if (asked == null || !Number.isFinite(asked)) return null;
  const wanted = Math.round(asked);
  if (wanted === frames) return null;
  return wanted > frames
    ? `You asked for ${wanted} frames; a ${kind} holds at most ${frames}, so this one has ${frames}.`
    : `You asked for ${wanted} frames; a ${kind} needs at least ${frames}, so this one has ${frames}.`;
}

function pendingFrames(
  live: readonly GenerationRow[],
  checkpoint: Pick<SequenceCheckpoint, "frames">,
  frameCount: number,
): number[] {
  const delivered = new Set(
    live.filter((r) => r.status === "succeeded").map((r) => r.frameIndex),
  );
  return Array.from({ length: frameCount }, (_, i) => i).filter(
    (i) => !delivered.has(i) && checkpoint.frames[String(i)] === undefined,
  );
}

/**
 * A carousel or presentation as a set of frames (KOOS-AI-002), resumable
 * across slices (H8).
 *
 *  1. One planner call writes every frame (planSequence); a plan that
 *     breaks the set's promise fails here, before any row or charge.
 *  2. The plan is checkpointed (a resumed slice never plans again), then
 *     the shared kit is settled and the set row and one design_generations
 *     row per frame are written.
 *  3. Frames without a delivered row render in waves (renderWaves), each
 *     on the set's palette, logo and fonts, through the directions gate.
 *     Each finished frame is checkpointed; at the slice deadline the job
 *     pauses and the poll route resumes it.
 *  4. On completion, fact coverage is measured across the drawn frames and
 *     each delivered frame is billed once: one unit per frame. A set that
 *     fails instead is settled (settleSetOnFailure): the frames it did
 *     deliver are billed and the ones it never drew are marked failed.
 */
export async function generateSequenceWork(
  {
    context,
    userId,
    sessionId,
    request,
    contextRequest,
  }: {
    context: DesignContext;
    userId: string;
    sessionId?: string | null;
    request: SequenceRequest;
    contextRequest?: SequenceContextRequest;
  },
  runtime: JobRuntime,
): Promise<{ resultId?: string; result: SequenceJobResult }> {
  if (!multiFrameEnabled()) throw new MultiFrameDisabledError();
  const kind = sequenceKindOf(context.designType);
  if (!kind) throw new MultiFrameDisabledError();
  const source: SequenceImageSource = request.image.source;
  if (source === "ko" && !koImageryEnabled()) {
    throw new KoImageryDisabledError();
  }
  const brandId = context.brand.id;
  /* The count asked for, until the plan is written: a frame the planner
     dropped rather than ship a blocking fault (framesDropped) is neither
     drawn nor billed. */
  let frameCount = request.frames;
  const uploadKey =
    request.image.source === "upload" ? request.image.key : null;
  const report = (
    done: number,
    label: string,
    stage: "brief" | "render" | "checks",
  ) => runtime.reportProgress({ stage, done, total: frameCount, label });
  const startedAt = Date.now();
  let state: SequenceCheckpoint | null = null;

  try {
    state = resumedState(runtime.checkpoint);
    if (!state) {
      const notice = frameCountNotice(kind, frameCount, request.asked);
      report(
        0,
        notice
          ? `Planning ${frameCount} frames… ${notice}`
          : `Planning ${frameCount} frames…`,
        "brief",
      );
      state = await planSet({
        context,
        kind,
        frameCount,
        source,
        uploadKey,
        startedAt,
      });
      await runtime.saveCheckpoint({ ...state });
    }
    const set = state;
    const { setId, plan } = set;
    frameCount = plan.frames.length;
    if (set.completed) {
      return setResult(
        set,
        liveFrames(await listSetFrames(brandId, setId)),
        source,
      );
    }

    const { kit, logoFault, logoIsWhatWeAreDesigning } = await buildKit({
      context,
      plan,
      source,
      uploadKey,
      facts: state.facts,
      offering: state.offering,
    });
    /* Written on every slice and ignored once it exists, so a slice killed
       between the checkpoint and this write still leaves the set its plan.
       After the kit, so a kit that cannot be built leaves no set behind. */
    await createDesignSet({
      id: setId,
      brandId,
      kind,
      frameCount,
      plan,
      facts: state.facts,
      offering: state.offering,
      request: contextRequest ?? {},
    });

    /* Rows already written by an earlier slice are reused, so a resumed set
       never holds two rows for one frame. */
    let rows = await listSetFrames(brandId, setId);
    const rowFor = new Map<number, string>();
    for (const row of liveFrames(rows)) {
      if (row.frameIndex != null) rowFor.set(row.frameIndex, row.id);
    }
    await Promise.all(
      plan.frames.map(async (beat, i) => {
        if (rowFor.has(i)) return;
        const row = await createDesignGeneration({
          brandId,
          userId,
          source: context.source,
          briefId: context.briefId,
          calendarItemId: context.calendarItemId,
          attachments: context.attachments,
          designType: context.designType,
          spec: kitSpec(kit, plan, i),
          renderer: "composite",
          provider: providerOf(kit),
          model: kit.plates?.adapter.model ?? "none",
          status: "pending",
          rationale: frameRationale(beat),
          imageSource: source,
          sourceImageKey: uploadKey,
          setId,
          frameIndex: i,
          frameCount,
        });
        rowFor.set(i, row.id);
      }),
    );
    rows = await listSetFrames(brandId, setId);

    const live = liveFrames(rows);
    const drawnLayouts = new Map<number, string>();
    for (const row of live) {
      const layout = (row.spec as Partial<DesignSpec> | null)?.layout;
      if (row.status === "succeeded" && row.frameIndex != null && layout) {
        drawnLayouts.set(row.frameIndex, layout);
      }
    }
    const pending = pendingFrames(live, state, frameCount);
    const largestImage = kit.photo
      ? (() => {
          const size = readImageDimensions(kit.photo.placed.asset.bytes);
          return size ? size.width * size.height : 0;
        })()
      : 0;
    const concurrency = Math.min(
      MAX_FRAME_CONCURRENCY,
      renderConcurrency({
        directions: Math.max(1, pending.length),
        freeBytes: freemem(),
        imagePixels: largestImage,
      }),
    );

    const frames = state.frames;
    /* Two frames finish at once at concurrency 2. Each write is queued
       behind the last and snapshots the records when it runs, so the last
       write to land always carries every finished frame: a stale snapshot
       landing late would drop a failed frame's record and draw it again. */
    let checkpointWrites = Promise.resolve();
    const persistFrames = () => {
      checkpointWrites = checkpointWrites.then(() =>
        runtime.saveCheckpoint({ frames: { ...frames } }),
      );
      return checkpointWrites;
    };
    const outcomes: FrameOutcome[] = [];
    let settledCount = frameCount - pending.length;
    for (const wave of renderWaves(pending)) {
      await mapWithConcurrency(
        wave,
        concurrency,
        async (index) => {
          report(
            settledCount,
            `Frame ${index + 1} of ${frameCount}…`,
            "render",
          );
          const outcome = await renderFrame(kit, {
            rowId: rowFor.get(index) as string,
            index,
            beat: plan.frames[index],
            spec: kitSpec(kit, plan, index),
            held: heldByNeighbours(index, drawnLayouts, plan.frames),
            outOfTime: () => runtime.shouldPause(),
          });
          if (outcome.layout) drawnLayouts.set(index, outcome.layout);
          /* Billed as it lands, not when the set completes: a slice that
             pauses and is never resumed (the tab was closed) still pays for
             the frames it put on show (H7). */
          if (outcome.record.status === "succeeded") {
            await billFrames({
              userId,
              brandId,
              state: set,
              frames: [
                {
                  id: outcome.rowId,
                  frameIndex: index,
                  provider: providerOf(kit),
                  imageSource: source,
                  source: context.source,
                  layout: outcome.layout,
                  record: outcome.record,
                },
              ],
            }).catch((err) => {
              console.error(
                `design frame ${outcome.rowId} could not be billed yet`,
                err,
              );
            });
          }
          outcomes.push(outcome);
          settledCount += 1;
          frames[String(index)] = outcome.record;
          await persistFrames();
        },
        { shouldStop: () => runtime.shouldPause() },
      );
    }

    const unfinished = pending.filter((i) => !frames[String(i)]);
    if (unfinished.length > 0) throw new JobPausedError();

    report(frameCount, "Checking the set…", "checks");
    return await completeSet({
      context,
      userId,
      sessionId,
      kind,
      source,
      state: set,
      kit,
      logoFault,
      logoIsWhatWeAreDesigning,
      outcomes,
      markCompleted: async () => {
        /* Locally too: a throw past this point is settled from `set`, and
           must not report the set a second time. */
        set.completed = true;
        await runtime.saveCheckpoint({ completed: true });
      },
    });
  } catch (err) {
    if (err instanceof JobPausedError) throw err;
    await settleSetOnFailure({
      brandId,
      userId,
      sessionId,
      requested: frameCount,
      checkpoint: state ?? { startedAt },
      reason: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** The checkpoint of a set planned by an earlier slice, or null. */
function resumedState(
  checkpoint: Record<string, unknown>,
): SequenceCheckpoint | null {
  const saved = checkpoint as Partial<SequenceCheckpoint>;
  if (!saved.plan || !saved.setId || !saved.planned || !saved.startedAt) {
    return null;
  }
  return {
    setId: saved.setId,
    plan: saved.plan,
    facts: saved.facts ?? [],
    offering: saved.offering ?? null,
    planned: saved.planned,
    frames: { ...(saved.frames ?? {}) },
    startedAt: saved.startedAt,
    completed: saved.completed === true,
  };
}

/** One planner call for the whole set, refused when the plan breaks the
 *  set's promise to the brief. */
async function planSet({
  context,
  kind,
  frameCount,
  source,
  uploadKey,
  startedAt,
}: {
  context: DesignContext;
  kind: SequenceKind;
  frameCount: number;
  source: SequenceImageSource;
  uploadKey: string | null;
  startedAt: number;
}): Promise<SequenceCheckpoint> {
  const brandId = context.brand.id;
  const upload = uploadKey ? await loadDesignImage(uploadKey, brandId) : null;
  const [memorySummary, recentLayouts] = await Promise.all([
    buildMemoryBlock(brandId),
    recentLayoutsFor(brandId),
  ]);
  const planned = await planSequence({
    context,
    kind,
    frameCount,
    imageSource: source,
    image: upload
      ? { bytes: new Uint8Array(upload.bytes), contentType: upload.contentType }
      : null,
    memorySummary,
    recentLayouts,
  }).catch((err) => {
    /* A blocking fault no repair cleared is refused before any frame
       renders or is billed; the user sees the same plain refusal as a set
       that broke a rule. */
    if (!(err instanceof SequenceShipRefusedError)) throw err;
    console.error("design sequence plan refused", {
      blockingFaults: err.faults.length,
    });
    throw new SequencePlanError(
      kind,
      err.faults.map((f) => ({
        frame: f.frame,
        rule: "blocking-fault" as const,
        detail: f.detail,
      })),
    );
  });
  const fatal = planned.problems.filter((p) => FATAL_RULES.includes(p.rule));
  if (
    planned.plan.frames.length !==
    frameCount - (planned.framesDropped ?? []).length
  ) {
    fatal.push({
      frame: null,
      rule: "count",
      detail: `planned ${planned.plan.frames.length} frames for ${frameCount}`,
    });
  }
  if (fatal.length > 0) {
    console.error("design sequence plan refused", { problems: fatal });
    throw new SequencePlanError(kind, fatal);
  }
  return {
    setId: randomUUID(),
    /* A deck is 16:9 whatever the planner answered: the canvas is the
       format's, not a choice of copy. */
    plan:
      kind === "presentation"
        ? { ...planned.plan, aspectRatio: PRESENTATION_ASPECT }
        : planned.plan,
    facts: planned.facts,
    offering: planned.offering,
    planned: {
      modelCalls: planned.modelCalls,
      repaired: planned.repaired,
      problems: planned.problems,
      invented: planned.invented.map((i) => `frame ${i.frame + 1}: ${i.text}`),
      factsDrawn: planned.factsDrawn,
      framesDropped: planned.framesDropped ?? [],
    },
    frames: {},
    startedAt,
  };
}

function providerOf(kit: FrameKit): string {
  return kit.plates?.adapter.id ?? (kit.photo ? "upload" : "none");
}

/** What the set as a whole says, measured on the frames it delivered. */
function setCoverage(
  state: Pick<SequenceCheckpoint, "facts" | "offering" | "plan">,
  delivered: readonly GenerationRow[],
) {
  const { facts, offering } = state;
  const frameCount = state.plan.frames.length;
  const missing = setFactsMissing(facts, delivered.map(drawnCopyOfRow));
  const hook = delivered.find((r) => r.frameIndex === 0);
  /* Null when there is nothing to name or no hook was delivered; a failed
     hook is already counted among the failed frames. */
  const hookNamesOffering =
    offering && hook ? copyNamesOffering(drawnCopyOfRow(hook), offering) : null;
  const setFaults = [
    ...(missing.length > 0
      ? [
          `the set leaves off ${missing.length} of the brief's ${facts.length} facts`,
        ]
      : []),
    ...(hookNamesOffering === false
      ? [`the hook frame does not name ${offering}`]
      : []),
    ...(delivered.length < frameCount
      ? [`${frameCount - delivered.length} of ${frameCount} frames failed`]
      : []),
  ];
  return { missing, hookNamesOffering, setFaults };
}

/** A delivered frame as its usage row describes it. */
interface FrameToBill {
  id: string;
  frameIndex: number | null;
  provider: string;
  imageSource: GenerationRow["imageSource"];
  source: GenerationRow["source"];
  layout: string | null;
  record: FrameRecord | undefined;
}

function frameToBill(
  row: GenerationRow,
  state: Pick<SequenceCheckpoint, "frames">,
): FrameToBill {
  return {
    id: row.id,
    frameIndex: row.frameIndex,
    provider: row.provider,
    imageSource: row.imageSource,
    source: row.source,
    layout: (row.spec as Partial<DesignSpec> | null)?.layout ?? null,
    record: state.frames[String(row.frameIndex)],
  };
}

/**
 * One usage row per delivered frame not billed yet. One usage row is one
 * quota unit (countDesignGenerationsForWorkspace): a set costs one unit per
 * frame delivered. A frame is billed as it lands; the set's end bills again
 * through the same gate only what a killed slice could not, so a frame is
 * never billed twice.
 */
async function billFrames({
  userId,
  brandId,
  state,
  frames,
}: {
  userId: string;
  brandId: string;
  state: Pick<SequenceCheckpoint, "setId" | "plan" | "facts" | "planned">;
  frames: readonly FrameToBill[];
}): Promise<void> {
  const { setId, plan } = state;
  const billed = new Set(await listBilledSetGenerations(brandId, setId));
  for (const frame of frames) {
    if (billed.has(frame.id)) continue;
    const { record } = frame;
    await recordUsageEvent({
      userId,
      brandId,
      kind: "design_generated",
      metadata: {
        setId,
        frameIndex: frame.frameIndex,
        frameCount: plan.frames.length,
        generationId: frame.id,
        generationIds: [frame.id],
        sequenceKind: plan.kind,
        role: plan.frames[frame.frameIndex ?? 0]?.role ?? null,
        layout: frame.layout,
        renderers: [`composite:${frame.provider}`],
        imageSource: frame.imageSource,
        imageCalls: record?.imageCalls ?? 0,
        plateCheck: record?.plateCheck ?? null,
        textLed: record?.textLed ?? false,
        source: frame.source,
        faults: record?.faults ?? [],
        qualityFaults: (record?.faults.length ?? 0) > 0 ? 1 : 0,
        briefFacts: state.facts.length,
        planModelCalls: state.planned.modelCalls,
        planRepaired: state.planned.repaired,
        planProblems: state.planned.problems.map((p) => p.rule),
        planInvented: state.planned.invented ?? [],
        planFactsDrawn: state.planned.factsDrawn ?? [],
      },
    });
  }
}

/**
 * The set's end, however it ended: bills any delivered frame its slice
 * could not, then writes what only the whole set knows onto every frame's
 * usage row. The annotation is a record, not a charge, so a failure to
 * write it is logged and the set still settles.
 */
async function billSet({
  userId,
  brandId,
  state,
  delivered,
  coverage,
  jobFailed,
}: {
  userId: string;
  brandId: string;
  state: SequenceCheckpoint;
  delivered: readonly GenerationRow[];
  coverage: ReturnType<typeof setCoverage>;
  jobFailed: boolean;
}): Promise<void> {
  await billFrames({
    userId,
    brandId,
    state,
    frames: delivered.map((row) => frameToBill(row, state)),
  });
  const frameCount = state.plan.frames.length;
  await annotateSetUsage(brandId, state.setId, {
    setFaults: coverage.setFaults,
    setFactsMissing: coverage.missing.map((f) => f.text),
    hookNamesOffering: coverage.hookNamesOffering,
    delivered: delivered.length,
    failed: frameCount - delivered.length,
    jobFailed,
  }).catch((err) => {
    console.error(
      `design set ${state.setId} usage could not be annotated`,
      err,
    );
  });
}

/** The set's one trace line (H14), written however the set ended. */
function logSequenceCompleted(trace: {
  setId: string | null;
  requested: number;
  delivered: number;
  failed: number;
  /** The brief's facts no delivered frame states, measured on drawn copy. */
  factsMissing: number;
  ms: number;
}) {
  console.log(`design.sequence.completed ${JSON.stringify(trace)}`);
}

/**
 * A set whose job failed for good: in the work, past the slice ceiling,
 * with its resumes spent, or refused a resume. The frames it delivered stay
 * on show, so they are billed (H7); the frames it never drew are marked
 * failed, so nothing waits on a row that will not change; and the trace
 * line is written. Safe to call more than once: billing goes through the
 * same gate as a completed set, and a row already failed stays so. Never
 * throws, so the job's own failure is what is reported.
 */
export async function settleSetOnFailure({
  brandId,
  userId,
  sessionId,
  requested,
  checkpoint,
  reason,
}: {
  brandId: string;
  userId: string;
  sessionId?: string | null;
  /** The frames asked for, when known: a set that never planned has no
   *  plan to count. */
  requested?: number;
  checkpoint: Partial<SequenceCheckpoint> | null | undefined;
  reason: string;
}): Promise<void> {
  const state = checkpoint ? resumedState(checkpoint) : null;
  const frameCount = state?.plan.frames.length ?? requested ?? 0;
  const startedAt = checkpoint?.startedAt;
  const ms = typeof startedAt === "number" ? Date.now() - startedAt : 0;
  try {
    if (!state) {
      logSequenceCompleted({
        setId: null,
        requested: frameCount,
        delivered: 0,
        failed: frameCount,
        factsMissing: 0,
        ms,
      });
      return;
    }
    const live = liveFrames(await listSetFrames(brandId, state.setId));
    const stopped = live.filter((r) => r.status === "pending");
    await Promise.all(
      stopped.map((row) =>
        updateDesignGeneration(row.id, {
          status: "failed",
          error: reason.slice(0, 500),
        }),
      ),
    );
    const delivered = live.filter((r) => r.status === "succeeded");
    const coverage = setCoverage(state, delivered);
    /* A set its completing slice already reported was told about once; a
       failure after that (the job's success write was lost) only makes sure
       of the bill. */
    if (state.completed) {
      await billFrames({
        userId,
        brandId,
        state,
        frames: delivered.map((row) => frameToBill(row, state)),
      });
      return;
    }
    await billSet({
      userId,
      brandId,
      state,
      delivered,
      coverage,
      jobFailed: true,
    });
    const failed = frameCount - delivered.length;
    logSequenceCompleted({
      setId: state.setId,
      requested: frameCount,
      delivered: delivered.length,
      failed,
      factsMissing: coverage.missing.length,
      ms,
    });
    await captureServerEvent({
      distinctId: userId,
      event: "design_sequence_generated",
      properties: {
        brand_id: brandId,
        session_id: sessionId ?? null,
        set_id: state.setId,
        kind: state.plan.kind,
        requested: frameCount,
        delivered: delivered.length,
        failed,
        facts_missing: coverage.missing.length,
        job_failed: true,
        ms,
      },
    });
  } catch (err) {
    console.error(
      `design set ${state?.setId ?? "(unplanned)"} could not be settled`,
      err,
    );
  }
}

/** Settles the set of a sequence job that is being failed outside its work:
 *  the poll route, or a resume that cannot start. */
export async function settleSequenceJobOnFailure(
  job: { userId: string; brandId: string; input: unknown; result?: unknown },
  reason: string,
): Promise<void> {
  const input = job.input as Partial<SequenceJobInput> | null;
  await settleSetOnFailure({
    brandId: job.brandId,
    userId: job.userId,
    requested: input?.sequence?.frames,
    checkpoint: checkpointOf(job.result),
    reason,
  });
}

/** Fails the row a frame regenerate was drawing when its job is failed
 *  from outside. The frame on show was never superseded, so it stays. */
export async function settleRegenerateJobOnFailure(
  job: { result?: unknown },
  reason: string,
): Promise<void> {
  const rowId = (checkpointOf(job.result) as { rowId?: unknown } | null)?.rowId;
  if (typeof rowId !== "string") return;
  await failPendingGeneration(rowId, reason.slice(0, 500)).catch((err) => {
    console.error(`design frame ${rowId} could not be marked failed`, err);
  });
}

/** Settles whatever a design job that bills frames left behind: a set, or
 *  one frame being drawn again. Anything else has nothing to settle. */
export async function settleFrameJobOnFailure(
  job: { userId: string; brandId: string; input: unknown; result?: unknown },
  reason: string,
): Promise<void> {
  if (isSequenceJobInput(job.input)) {
    await settleSequenceJobOnFailure(job, reason);
  } else if (isRegenerateFrameJobInput(job.input)) {
    await settleRegenerateJobOnFailure(job, reason);
  }
}

export const ABANDONED_SET_ERROR =
  "This set stopped before every frame was drawn. The frames it finished are kept and charged; redraw any missing frame on its own.";

/**
 * Fails and settles a workspace's sets that nothing will come back to
 * (ABANDONED_SET_MS): only the poll route resumes a set, so one whose tab
 * was closed would otherwise sit with pending frames and reserved quota
 * forever. Its delivered frames were billed as they landed; this bills any
 * a killed slice missed and fails the rest. Run before a workspace's quota
 * is checked, so the units the set no longer needs are free again. Never
 * throws: a sweep that fails leaves the request it rides on unharmed.
 */
export async function sweepAbandonedDesignSets(
  workspaceId: string,
  now = Date.now(),
): Promise<number> {
  try {
    const failed = await failAbandonedDesignJobs(
      workspaceId,
      new Date(now - ABANDONED_SET_MS),
      ABANDONED_SET_ERROR,
    );
    for (const job of failed) {
      console.log(`design job ${job.id} abandoned; settled by the sweep`);
      await settleFrameJobOnFailure(job, ABANDONED_SET_ERROR);
    }
    return failed.length;
  } catch (err) {
    console.error(`abandoned design sets of ${workspaceId} not swept`, err);
    return 0;
  }
}

/** The checkpoint executeGenerationJob parks in a running job's result. */
function checkpointOf(result: unknown): Partial<SequenceCheckpoint> | null {
  if (!result || typeof result !== "object") return null;
  const checkpoint = (result as { checkpoint?: unknown }).checkpoint;
  return checkpoint && typeof checkpoint === "object"
    ? (checkpoint as Partial<SequenceCheckpoint>)
    : null;
}

async function completeSet({
  context,
  userId,
  sessionId,
  kind,
  source,
  state,
  kit,
  logoFault,
  logoIsWhatWeAreDesigning,
  outcomes,
  markCompleted,
}: {
  context: DesignContext;
  userId: string;
  sessionId?: string | null;
  kind: SequenceKind;
  source: SequenceImageSource;
  state: SequenceCheckpoint;
  kit: FrameKit;
  logoFault: string | null;
  logoIsWhatWeAreDesigning: boolean;
  outcomes: FrameOutcome[];
  /** Checkpoints that the set is billed and about to be reported. */
  markCompleted: () => Promise<void>;
}): Promise<{ resultId?: string; result: SequenceJobResult }> {
  const brandId = context.brand.id;
  const { setId, plan } = state;
  const frameCount = plan.frames.length;
  const live = liveFrames(await listSetFrames(brandId, setId));
  const delivered = live.filter((r) => r.status === "succeeded");

  /* Thrown to the work's catch, which settles the set: its rows are
     already failed, and the trace line records the whole set failing. */
  if (delivered.length === 0) {
    const reasons = outcomes
      .map((o) => o.error)
      .filter((e): e is string => Boolean(e));
    const sameReason =
      reasons.length > 0 && reasons.every((r) => r === reasons[0]);
    throw new Error(
      sameReason
        ? (reasons[0] as string)
        : `We couldn't make any frame of this ${kind}. Please try again.`,
    );
  }

  const coverage = setCoverage(state, delivered);
  await billSet({
    userId,
    brandId,
    state,
    delivered,
    coverage,
    jobFailed: false,
  });
  /* Everything below tells someone; at most once, so a resume of a slice
     killed past this point returns the result without telling them again. */
  await markCompleted();

  /* Once per set: a fault in the brand's own files is the same on every
     frame and every slice. */
  await notifyBrandAssetFaults(userId, {
    font: kit.fonts.fault
      ? [kit.fonts.fault]
      : outcomes
          .map((o) => o.brandFontFault)
          .filter((f): f is string => Boolean(f)),
    logo: [logoFault, ...outcomes.map((o) => o.logoFault)].filter(
      (f): f is string => Boolean(f),
    ),
  });

  const recordOf = (row: GenerationRow): FrameRecord | undefined =>
    state.frames[String(row.frameIndex)];
  const textLed = delivered.filter(
    (r) =>
      source !== "none" &&
      recordOf(r)?.textLed &&
      plan.frames[r.frameIndex ?? 0]?.showsImage,
  );
  if (textLed.length > 0) {
    const imageModelDown = textLed.every(
      (r) => recordOf(r)?.plateCheck === "unavailable",
    );
    await notifyFramesTextLed(
      userId,
      framesTextLedMessage({
        kind,
        frames: textLed.length,
        of: frameCount,
        cause:
          source === "upload"
            ? "photo-fits-none"
            : imageModelDown
              ? "unavailable"
              : "rejected",
        subject: state.offering,
      }),
    );
  }
  if (
    kit.logoFree &&
    (context.brand.logoUrl || context.logoAssetUrls.length > 0)
  ) {
    await notifyLogoLeftOff({
      userId,
      reason: logoIsWhatWeAreDesigning
        ? `this is a ${context.designType} — the brand's current mark would be sitting on its own replacement`
        : `the brief asked for it: "${kit.logoFreeQuote.trim()}"`,
    });
  }

  const ms = Date.now() - state.startedAt;
  logSequenceCompleted({
    setId,
    requested: frameCount,
    delivered: delivered.length,
    failed: frameCount - delivered.length,
    factsMissing: coverage.missing.length,
    ms,
  });
  const records = Object.values(state.frames);
  await captureServerEvent({
    distinctId: userId,
    event: "design_sequence_generated",
    properties: {
      brand_id: brandId,
      session_id: sessionId ?? null,
      set_id: setId,
      kind,
      source: context.source,
      image_source: source,
      requested: frameCount,
      delivered: delivered.length,
      failed: frameCount - delivered.length,
      quality_faults: records.filter((r) => r.faults.length > 0).length,
      facts_missing: coverage.missing.length,
      hook_names_offering: coverage.hookNamesOffering,
      image_calls: records.reduce((n, r) => n + r.imageCalls, 0),
      text_led: textLed.length,
      plan_repaired: state.planned.repaired,
      plan_model_calls: state.planned.modelCalls,
      job_failed: false,
      ms,
    },
  });

  return setResult(state, live, source);
}

/** The job's result, read off the set's frames on show. */
function setResult(
  state: Pick<SequenceCheckpoint, "setId" | "plan" | "planned">,
  live: readonly GenerationRow[],
  source: SequenceImageSource,
): { resultId?: string; result: SequenceJobResult } {
  const generationIds = live
    .filter((r) => r.status === "succeeded")
    .map((r) => r.id);
  return {
    resultId: generationIds[0],
    result: {
      kind: "sequence",
      setId: state.setId,
      sequenceKind: state.plan.kind,
      frameCount: state.plan.frames.length,
      ...((state.planned?.framesDropped ?? []).length > 0
        ? { framesDropped: state.planned.framesDropped }
        : {}),
      generationIds,
      failed: live.filter((r) => r.status === "failed").map((r) => r.id),
      imageSource: source,
    },
  };
}

/**
 * Continues a sequence job from its checkpoint in a fresh invocation, called
 * by the poll route (via after()) when the last slice paused or went silent.
 * The context is resolved again from the job's input; the plan is not.
 */
export async function resumeDesignSequenceJob(job: {
  id: string;
  userId: string;
  brandId: string;
  input: unknown;
  result?: unknown;
}): Promise<void> {
  const input = job.input as Partial<SequenceJobInput> | null;
  const fail = async (error: string) => {
    await updateGenerationJob(job.id, { status: "failed", error });
    await settleSequenceJobOnFailure(job, error);
  };
  if (!input?.sequence || !input.image) {
    await fail("Generation could not be resumed. Please try again.");
    return;
  }
  if (!multiFrameEnabled()) {
    await fail(new MultiFrameDisabledError().message);
    return;
  }
  const contextRequest = contextRequestOf(input);
  let context: DesignContext;
  try {
    context = await resolveDesignContext({
      brandId: job.brandId,
      ...contextRequest,
    });
  } catch (err) {
    await fail(
      err instanceof DesignContextError
        ? err.message
        : "Generation could not be resumed. Please try again.",
    );
    return;
  }
  const image = input.image;
  const frames = input.sequence.frames;
  const asked = input.sequence.asked ?? null;
  await executeGenerationJob(
    job.id,
    (runtime) =>
      generateSequenceWork(
        {
          context,
          userId: job.userId,
          sessionId: null,
          request: { image, frames, asked },
          contextRequest,
        },
        runtime,
      ),
    {
      softDeadlineMs: SEQUENCE_SLICE_BUDGET_MS,
      onSliceCeiling: (checkpoint, error) =>
        settleSetOnFailure({
          brandId: job.brandId,
          userId: job.userId,
          requested: frames,
          checkpoint,
          reason: error,
        }),
    },
  );
}

export function contextRequestOf(
  value: Partial<SequenceContextRequest> | null | undefined,
): SequenceContextRequest {
  return {
    briefId: value?.briefId ?? null,
    calendarItemId: value?.calendarItemId ?? null,
    attachments: Array.isArray(value?.attachments) ? value.attachments : [],
    freeform: value?.freeform ?? null,
    aspectRatio: value?.aspectRatio ?? null,
  };
}

/**
 * One frame of a set drawn again (H9): a new beat from the user's edits as
 * typed, or a model rewrite, drawn on the palette, logo and fonts the set
 * already has. A new row takes the same set and frame index; the old row is
 * superseded only once the new one is delivered, so a failed regenerate
 * leaves the frame on show as it was. One quota unit.
 */
export async function regenerateFrameWork(
  {
    context,
    userId,
    sessionId,
    generationId,
    edits,
  }: {
    context: DesignContext;
    userId: string;
    sessionId?: string | null;
    generationId: string;
    edits?: FrameEdits;
  },
  runtime: JobRuntime,
): Promise<{ resultId: string; result: RegenerateFrameJobResult }> {
  if (!multiFrameEnabled()) throw new MultiFrameDisabledError();
  const brandId = context.brand.id;
  const requested = await getDesignGenerationById(generationId);
  if (
    !requested ||
    requested.brandId !== brandId ||
    !requested.setId ||
    requested.frameIndex == null ||
    requested.frameCount == null
  ) {
    throw new FrameTargetError();
  }
  const set = await getDesignSet(brandId, requested.setId);
  if (!set) throw new FrameTargetError();
  const setId = requested.setId;
  const index = requested.frameIndex;
  const frameCount = requested.frameCount;
  const target = frameToReplace(await listSetFrames(brandId, setId), requested);
  const plan = set.plan as PlannedSequence;
  const kind = set.kind as SequenceKind;
  const source: SequenceImageSource = target.imageSource ?? "none";
  if (source === "ko" && !koImageryEnabled()) {
    throw new KoImageryDisabledError();
  }
  const report = (
    done: number,
    label: string,
    stage: "brief" | "render" | "checks",
  ) => runtime.reportProgress({ stage, done, total: 2, label });
  const edited = Boolean(edits && Object.keys(edits).length > 0);
  report(
    0,
    edited
      ? `Setting your copy on frame ${index + 1}…`
      : `Rewriting frame ${index + 1}…`,
    "brief",
  );

  /* The facts and offering the set was planned against, so a rewrite is
     held to those and an edit reports the ones it uncovers, without a
     second brief read that could return a different list. */
  const { beat, modelCalls, uncovered } = await replanFrame(
    { context, plan, index, edits },
    {
      facts: (set.facts as BriefFact[]) ?? [],
      offering: set.offering,
    },
  );
  const replanned: PlannedSequence = {
    ...plan,
    frames: plan.frames.map((b, i) => (i === index ? beat : b)),
  };
  const live = liveFrames(await listSetFrames(brandId, setId));
  /* The palette the set was drawn in, read off a delivered frame: a cut-out
     may have turned the plan's, and a regenerated frame must match the
     frames beside it, not the plan. */
  const drawnPalette = live
    .filter((r) => r.status === "succeeded")
    .map((r) => (r.spec as Partial<DesignSpec> | null)?.palette)
    .find((p): p is Palette => Boolean(p));
  const { kit, logoFault } = await buildKit({
    context,
    plan: replanned,
    source,
    uploadKey: target.sourceImageKey ?? null,
    facts: (set.facts as BriefFact[]) ?? [],
    offering: set.offering,
    palette: drawnPalette ?? plan.palette,
  });
  const drawnLayouts = new Map<number, string>();
  for (const row of live) {
    const layout = (row.spec as Partial<DesignSpec> | null)?.layout;
    if (row.status === "succeeded" && row.frameIndex != null && layout) {
      drawnLayouts.set(row.frameIndex, layout);
    }
  }
  const spec = kitSpec(kit, replanned, index);
  const row = await createDesignGeneration({
    brandId,
    userId,
    source: context.source,
    briefId: context.briefId,
    calendarItemId: context.calendarItemId,
    attachments: context.attachments,
    designType: target.designType ?? context.designType,
    spec,
    renderer: "composite",
    provider: providerOf(kit),
    model: kit.plates?.adapter.model ?? "none",
    status: "pending",
    rationale: frameRationale(beat),
    imageSource: source,
    sourceImageKey: target.sourceImageKey ?? null,
    setId,
    frameIndex: index,
    frameCount,
  });
  /* So a job failed from outside (stalled, swept) can fail this row too,
     rather than leave it pending in the set's history. */
  await runtime.saveCheckpoint({ rowId: row.id });
  report(1, `Drawing frame ${index + 1} of ${frameCount}…`, "render");
  const outcome = await renderFrame(kit, {
    rowId: row.id,
    index,
    beat,
    spec,
    held: heldByNeighbours(index, drawnLayouts, replanned.frames),
    outOfTime: () => runtime.shouldPause(),
  });
  await notifyBrandAssetFaults(userId, {
    font: [kit.fonts.fault, outcome.brandFontFault].filter((f): f is string =>
      Boolean(f),
    ),
    logo: [logoFault, outcome.logoFault].filter((f): f is string => Boolean(f)),
  });
  if (outcome.record.status !== "succeeded") {
    throw new Error(
      outcome.error ??
        `Frame ${index + 1} could not be drawn. Please try again.`,
    );
  }

  /* Every finished row at this index steps aside for the new one: the one
     asked for, and any another regenerate delivered meanwhile. A row still
     rendering is left alone; it supersedes this one when it lands, so the
     index always keeps exactly one frame on show. */
  const replaced = (await listSetFrames(brandId, setId)).filter(
    (r) =>
      r.frameIndex === index &&
      r.id !== row.id &&
      !r.supersededBy &&
      r.status !== "pending",
  );
  const toSupersede = new Set([target.id, ...replaced.map((r) => r.id)]);
  for (const id of toSupersede) await supersedeFrame(id, row.id);
  await replaceDesignSetBeat(setId, index, beat);

  await recordUsageEvent({
    userId,
    brandId,
    kind: "design_generated",
    metadata: {
      setId,
      frameIndex: index,
      frameCount,
      generationId: row.id,
      generationIds: [row.id],
      regenerateOf: target.id,
      sequenceKind: kind,
      role: beat.role,
      edited,
      modelCalls,
      uncovered: uncovered.map((f) => f.text),
      renderers: [`composite:${providerOf(kit)}`],
      imageSource: source,
      imageCalls: outcome.record.imageCalls,
      plateCheck: outcome.record.plateCheck,
      textLed: outcome.record.textLed,
      source: context.source,
      faults: outcome.record.faults,
      qualityFaults: outcome.record.faults.length > 0 ? 1 : 0,
    },
  });
  await captureServerEvent({
    distinctId: userId,
    event: "design_frame_regenerated",
    properties: {
      brand_id: brandId,
      session_id: sessionId ?? null,
      set_id: setId,
      frame_index: index,
      kind,
      edited,
      image_source: source,
      quality_faults: outcome.record.faults.length > 0 ? 1 : 0,
    },
  });

  return {
    resultId: row.id,
    result: {
      kind: "frame",
      setId,
      frameIndex: index,
      generationId: row.id,
      replaced: target.id,
      uncovered: uncovered.map((f) => f.text),
    },
  };
}
