import { randomUUID } from "node:crypto";
import { freemem } from "node:os";
import { getPlateAdapter } from "@/lib/ai/image";
import type { AspectRatio } from "@/lib/ai/image/types";
import { buildMemoryBlock } from "@/lib/ai/memory";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import {
  createDesignGeneration,
  createDesignSet,
  createNotification,
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
import { planSequence } from "@/lib/design/sequence/plan";
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
import { SEQUENCE_SLICE_BUDGET_MS } from "./stale";

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
  sequence: { frames: number };
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
  };
  /** Frames that finished, delivered or failed, with what they carried, so a
   *  later slice neither renders them again nor loses their record. */
  frames: Record<string, FrameRecord>;
  startedAt: number;
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
    super(
      `We couldn't plan this ${kind} as a set that keeps to your brief. Try again, or add more detail to the brief.`,
    );
    this.name = "SequencePlanError";
  }
}

/** The frame asked for is gone, not this brand's, or not a frame. */
export class FrameTargetError extends Error {
  constructor() {
    super("The frame you asked to regenerate no longer exists.");
    this.name = "FrameTargetError";
  }
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
  }: {
    rowId: string;
    index: number;
    beat: FrameBeat;
    spec: DesignSpec;
    held: string[];
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
      /* A frame takes no judge correction: every change the judge can draw
         is to the palette, the logo corner, the footer or the copy, which
         are the set's shared system or copy the plan was held to (or the
         user typed). The gate still checks the frame and records what it
         finds, at no model cost. */
      outOfTime: () => true,
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

async function notifyFramesTextLed(
  userId: string,
  kind: SequenceKind,
  frames: number,
  of: number,
  source: SequenceImageSource,
) {
  const why =
    source === "upload"
      ? "your photo couldn't be shown whole and clear of the words on them at this size"
      : "the images KO made for them couldn't be used";
  await createNotification({
    userId,
    type: "system",
    payload: {
      message: `${frames} of the ${of} frames of this ${kind} were laid out with words only: ${why}. Regenerate those frames to try again, or upload your own photo.`,
    },
  }).catch((err) => {
    console.error("frame imagery notification failed", err);
  });
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
 *  2. The plan, the set row and one design_generations row per frame are
 *     written, and the plan is checkpointed: a resumed slice never plans
 *     again.
 *  3. Frames without a delivered row render in waves (renderWaves), each
 *     on the set's palette, logo and fonts, through the directions gate.
 *     Each finished frame is checkpointed; at the slice deadline the job
 *     pauses and the poll route resumes it.
 *  4. On completion, fact coverage is measured across the drawn frames and
 *     each delivered frame is billed once: one unit per frame.
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
  const frameCount = request.frames;
  const uploadKey =
    request.image.source === "upload" ? request.image.key : null;
  const report = (
    done: number,
    label: string,
    stage: "brief" | "render" | "checks",
  ) => runtime.reportProgress({ stage, done, total: frameCount, label });

  const saved = runtime.checkpoint as Partial<SequenceCheckpoint>;
  let state: SequenceCheckpoint;
  if (saved.plan && saved.setId && saved.planned && saved.startedAt) {
    state = {
      setId: saved.setId,
      plan: saved.plan,
      facts: saved.facts ?? [],
      offering: saved.offering ?? null,
      planned: saved.planned,
      frames: { ...(saved.frames ?? {}) },
      startedAt: saved.startedAt,
    };
  } else {
    report(0, `Planning ${frameCount} frames…`, "brief");
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
        ? {
            bytes: new Uint8Array(upload.bytes),
            contentType: upload.contentType,
          }
        : null,
      memorySummary,
      recentLayouts,
    });
    const fatal = planned.problems.filter((p) => FATAL_RULES.includes(p.rule));
    if (planned.plan.frames.length !== frameCount) {
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
    state = {
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
      },
      frames: {},
      startedAt: Date.now(),
    };
    await runtime.saveCheckpoint({ ...state });
  }
  const { setId, plan } = state;
  /* Written on every slice and ignored once it exists, so a slice killed
     between the checkpoint and this write still leaves the set its plan. */
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

  const { kit, logoFault, logoIsWhatWeAreDesigning } = await buildKit({
    context,
    plan,
    source,
    uploadKey,
    facts: state.facts,
    offering: state.offering,
  });

  /* Rows already written by an earlier slice are reused, so a resumed set
     never holds two rows for one frame. */
  let rows = await listSetFrames(brandId, setId);
  const rowFor = new Map<number, string>();
  for (const row of liveFrames(rows)) {
    if (row.frameIndex != null) rowFor.set(row.frameIndex, row.id);
  }
  const imageProvider =
    kit.plates?.adapter.id ?? (kit.photo ? "upload" : "none");
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
        provider: imageProvider,
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

  const outcomes: FrameOutcome[] = [];
  let settledCount = frameCount - pending.length;
  for (const wave of renderWaves(pending)) {
    await mapWithConcurrency(
      wave,
      concurrency,
      async (index) => {
        report(settledCount, `Frame ${index + 1} of ${frameCount}…`, "render");
        const outcome = await renderFrame(kit, {
          rowId: rowFor.get(index) as string,
          index,
          beat: plan.frames[index],
          spec: kitSpec(kit, plan, index),
          held: heldByNeighbours(index, drawnLayouts, plan.frames),
        });
        if (outcome.layout) drawnLayouts.set(index, outcome.layout);
        outcomes.push(outcome);
        settledCount += 1;
        state.frames[String(index)] = outcome.record;
        await runtime.saveCheckpoint({ frames: { ...state.frames } });
      },
      { shouldStop: () => runtime.shouldPause() },
    );
  }

  const unfinished = pending.filter((i) => !state.frames[String(i)]);
  if (unfinished.length > 0) throw new JobPausedError();

  /* Once per set, on the slice that completes it: a fault in the brand's
     own files is the same on every frame and every slice. */
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

  report(frameCount, "Checking the set…", "checks");
  return completeSet({
    context,
    userId,
    sessionId,
    kind,
    source,
    state,
    kit,
    logoIsWhatWeAreDesigning,
    outcomes,
  });
}

async function completeSet({
  context,
  userId,
  sessionId,
  kind,
  source,
  state,
  kit,
  logoIsWhatWeAreDesigning,
  outcomes,
}: {
  context: DesignContext;
  userId: string;
  sessionId?: string | null;
  kind: SequenceKind;
  source: SequenceImageSource;
  state: SequenceCheckpoint;
  kit: FrameKit;
  logoIsWhatWeAreDesigning: boolean;
  outcomes: FrameOutcome[];
}): Promise<{ resultId?: string; result: SequenceJobResult }> {
  const brandId = context.brand.id;
  const { setId, plan, facts, offering } = state;
  const frameCount = plan.frames.length;
  const live = liveFrames(await listSetFrames(brandId, setId));
  const delivered = live.filter((r) => r.status === "succeeded");
  const failed = live.filter((r) => r.status === "failed").map((r) => r.id);

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

  const drawn = delivered.map(drawnCopyOfRow);
  const missing = setFactsMissing(facts, drawn);
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
  const recordOf = (row: GenerationRow): FrameRecord | undefined =>
    state.frames[String(row.frameIndex)];

  /* One usage row is one quota unit (countDesignGenerationsForWorkspace):
     a set costs one unit per frame delivered, and a frame billed before a
     resumed slice is never billed again. */
  const billed = new Set(await listBilledSetGenerations(brandId, setId));
  const imageProvider =
    kit.plates?.adapter.id ?? (kit.photo ? "upload" : "none");
  for (const row of delivered) {
    if (billed.has(row.id)) continue;
    const record = recordOf(row);
    await recordUsageEvent({
      userId,
      brandId,
      kind: "design_generated",
      metadata: {
        setId,
        frameIndex: row.frameIndex,
        frameCount,
        generationId: row.id,
        generationIds: [row.id],
        sequenceKind: kind,
        role: plan.frames[row.frameIndex ?? 0]?.role ?? null,
        layout: (row.spec as Partial<DesignSpec> | null)?.layout ?? null,
        renderers: [`composite:${imageProvider}`],
        imageSource: source,
        imageCalls: record?.imageCalls ?? 0,
        plateCheck: record?.plateCheck ?? null,
        textLed: record?.textLed ?? false,
        source: context.source,
        faults: record?.faults ?? [],
        qualityFaults: (record?.faults.length ?? 0) > 0 ? 1 : 0,
        setFaults,
        briefFacts: facts.length,
        setFactsMissing: missing.map((f) => f.text),
        hookNamesOffering,
        delivered: delivered.length,
        failed: failed.length,
        planModelCalls: state.planned.modelCalls,
        planRepaired: state.planned.repaired,
        planProblems: state.planned.problems.map((p) => p.rule),
      },
    });
  }

  const textLedFrames = delivered.filter(
    (r) =>
      source !== "none" &&
      recordOf(r)?.textLed &&
      plan.frames[r.frameIndex ?? 0]?.showsImage,
  ).length;
  if (textLedFrames > 0) {
    await notifyFramesTextLed(userId, kind, textLedFrames, frameCount, source);
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
  console.log(
    `design.sequence.completed ${JSON.stringify({
      setId,
      requested: frameCount,
      delivered: delivered.length,
      failed: failed.length,
      ms,
    })}`,
  );
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
      failed: failed.length,
      quality_faults: records.filter((r) => r.faults.length > 0).length,
      facts_missing: missing.length,
      hook_names_offering: hookNamesOffering,
      image_calls: records.reduce((n, r) => n + r.imageCalls, 0),
      text_led: textLedFrames,
      plan_repaired: state.planned.repaired,
      plan_model_calls: state.planned.modelCalls,
      ms,
    },
  });

  const generationIds = delivered.map((r) => r.id);
  return {
    resultId: generationIds[0],
    result: {
      kind: "sequence",
      setId,
      sequenceKind: kind,
      frameCount,
      generationIds,
      failed,
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
}): Promise<void> {
  const input = job.input as Partial<SequenceJobInput> | null;
  const fail = (error: string) =>
    updateGenerationJob(job.id, { status: "failed", error });
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
  await executeGenerationJob(
    job.id,
    (runtime) =>
      generateSequenceWork(
        {
          context,
          userId: job.userId,
          sessionId: null,
          request: { image, frames },
          contextRequest,
        },
        runtime,
      ),
    { softDeadlineMs: SEQUENCE_SLICE_BUDGET_MS },
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
  const target = await getDesignGenerationById(generationId);
  if (
    !target ||
    target.brandId !== brandId ||
    !target.setId ||
    target.frameIndex == null ||
    target.frameCount == null
  ) {
    throw new FrameTargetError();
  }
  const set = await getDesignSet(brandId, target.setId);
  if (!set) throw new FrameTargetError();
  const setId = target.setId;
  const index = target.frameIndex;
  const frameCount = target.frameCount;
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
  report(0, `Rewriting frame ${index + 1}…`, "brief");

  const { beat, modelCalls } = await replanFrame({
    context,
    plan,
    index,
    edits,
  });
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
    provider: kit.plates?.adapter.id ?? (kit.photo ? "upload" : "none"),
    model: kit.plates?.adapter.model ?? "none",
    status: "pending",
    rationale: frameRationale(beat),
    imageSource: source,
    sourceImageKey: target.sourceImageKey ?? null,
    setId,
    frameIndex: index,
    frameCount,
  });
  report(1, `Drawing frame ${index + 1} of ${frameCount}…`, "render");
  const outcome = await renderFrame(kit, {
    rowId: row.id,
    index,
    beat,
    spec,
    held: heldByNeighbours(index, drawnLayouts, replanned.frames),
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
      edited: Boolean(edits && Object.keys(edits).length > 0),
      modelCalls,
      renderers: [
        `composite:${kit.plates?.adapter.id ?? (kit.photo ? "upload" : "none")}`,
      ],
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
      edited: Boolean(edits && Object.keys(edits).length > 0),
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
    },
  };
}
