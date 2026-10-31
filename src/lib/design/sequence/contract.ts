/**
 * KOOS-AI-002 contract: a carousel or presentation is a set of frames.
 *
 * The single-frame DesignSpec stays the renderer's contract. A set adds one
 * layer above it: a plan that holds what every frame shares (palette, logo
 * behaviour, footer system: module 10 of the training manual) and one beat
 * per frame. frameSpec() in frame-spec.ts turns a beat into an ordinary spec,
 * so each frame renders through the same path a single design does.
 *
 * Every unit of this feature builds against these types. Changing one is a
 * contract change: update every side in the same commit.
 */
import type { AspectRatio } from "@/lib/ai/image/types";
import type { DesignContext } from "@/lib/design/context";
import { resolveDesignFormat } from "@/lib/design/formats";
import type { DesignSpec } from "@/lib/design/spec";
import type { BriefFact } from "@/lib/jobs/directions/brief-facts";

export const SEQUENCE_KINDS = ["carousel", "presentation"] as const;
export type SequenceKind = (typeof SEQUENCE_KINDS)[number];

export const FRAME_ROLES = ["hook", "body", "cta"] as const;
export type FrameRole = (typeof FRAME_ROLES)[number];

/* Upper bounds are set by the 300s job slice and the quota (one unit per
   frame), not by the platforms: Instagram allows 20, but a 20-frame job is
   20 renders and 20 units for one post. */
export const FRAME_BOUNDS: Record<
  SequenceKind,
  { min: number; max: number; fallback: number }
> = {
  carousel: { min: 2, max: 10, fallback: 5 },
  presentation: { min: 3, max: 12, fallback: 6 },
};

export const PRESENTATION_ASPECT: AspectRatio = "16:9";

export function sequenceKindOf(
  designType: string | null | undefined,
): SequenceKind | null {
  const format = resolveDesignFormat(designType ?? null);
  return format === "carousel" || format === "presentation" ? format : null;
}

/** The frame count a set is built with: the brief's own count when it gave
 *  one, clamped to what one job can deliver. */
export function clampFrameCount(
  kind: SequenceKind,
  requested: number | null | undefined,
): number {
  const { min, max, fallback } = FRAME_BOUNDS[kind];
  if (requested == null || !Number.isFinite(requested)) return fallback;
  return Math.min(max, Math.max(min, Math.round(requested)));
}

/** What one frame says and how it is laid out. */
export interface FrameBeat {
  role: FrameRole;
  /** What the frame is about in two or three words ("The price"), shown on
   *  the frame's card and used when it is regenerated. */
  title: string;
  headline: string;
  /** Empty string for none. */
  subheadline: string;
  /** Empty except on the cta frame. */
  cta: string;
  footerLines: string[];
  layout: DesignSpec["layout"];
  /** Whether this frame draws the set's image. False is a text-led frame. */
  showsImage: boolean;
  /** Plate scene for this frame when KO paints imagery; unused otherwise. */
  backgroundPrompt: string;
}

/** What every frame of the set shares (module 10). */
export interface PlannedSequence {
  kind: SequenceKind;
  palette: DesignSpec["palette"];
  logoPlacement: DesignSpec["logoPlacement"];
  logoFree: boolean;
  logoFreeQuote: string;
  backgroundTreatment: DesignSpec["backgroundTreatment"];
  footerStyle: DesignSpec["footerStyle"];
  aspectRatio: AspectRatio;
  frames: FrameBeat[];
}

export type SequenceRule =
  | "count"
  | "hook-first"
  | "cta-last"
  | "cta-only-last"
  | "layout-repeat"
  | "headline-repeat"
  | "copy-length"
  | "fact-uncovered"
  | "offering-unnamed"
  | "hook-without-image";

export interface SequenceProblem {
  /** Null for a problem of the set as a whole. */
  frame: number | null;
  rule: SequenceRule;
  detail: string;
}

export type SequenceImageSource = "upload" | "ko" | "none";

export interface PlanSequenceInput {
  context: DesignContext;
  kind: SequenceKind;
  frameCount: number;
  imageSource: SequenceImageSource;
  /** The upload, so the planner can see what it is laying out. */
  image: { bytes: Uint8Array; contentType: string } | null;
  memorySummary: string;
  recentLayouts: string[];
  /** The outline the user approved, already validated
   *  (validateApprovedOutline): frameCount equals its points' length and
   *  each frame states its own point only. Absent, the planner picks the
   *  points itself. */
  approvedOutline?: ApprovedOutline;
}

export interface PlanSequenceResult {
  plan: PlannedSequence;
  /** The brief's facts the plan was held to, so the job checks the same
   *  facts against what was actually drawn (set-level coverage, H5). */
  facts: BriefFact[];
  /** What the brief offers, in its words; the hook must name it. */
  offering: string | null;
  /** Problems still standing after the fix calls; the job decides
   *  which are fatal. Empty when the plan passed. */
  problems: SequenceProblem[];
  modelCalls: number;
  repaired: boolean;
}

/** A user's edit to one frame's copy. A field left out keeps its text. */
export interface FrameEdits {
  headline?: string;
  subheadline?: string;
  cta?: string;
}

export interface ReplanFrameInput {
  context: DesignContext;
  plan: PlannedSequence;
  index: number;
  /** Given: the user's words are used as written, no model call. Absent:
   *  the model rewrites the frame, keeping it distinct from its neighbours. */
  edits?: FrameEdits;
}

/** Stored in generation_jobs.result when a sequence job succeeds, and in
 *  the shape the client polls for. */
export interface SequenceJobResult {
  kind: "sequence";
  setId: string;
  sequenceKind: SequenceKind;
  frameCount: number;
  /** Delivered frames, in frame order. */
  generationIds: string[];
  failed: string[];
  imageSource: SequenceImageSource;
}

/** Stored when a regenerate-frame job succeeds. */
export interface RegenerateFrameJobResult {
  kind: "frame";
  setId: string;
  frameIndex: number;
  generationId: string;
  replaced: string;
  /** The brief facts the set stated before a user's edit and no frame
   *  states now, in the brief's words. The edit still stands (H9); this is
   *  what the set stopped saying, for the UI to warn about. Absent on
   *  results stored before it existed and on a model rewrite, which is
   *  refused instead of dropping a fact. */
  uncovered?: string[];
}

/** The frame fields SerializedGeneration carries; null on single designs. */
export interface SerializedFrame {
  setId: string;
  index: number;
  count: number;
  role: FrameRole;
  title: string;
}

/* The outline step (rubric Addendum A): a carousel or presentation is
   planned as N plain-words points the user approves or edits before any
   copy is written or frame rendered. OUTLINE.md holds the API contract. */

export const OUTLINE_SOURCES = ["brief", "profile", "user"] as const;
export type OutlineSource = (typeof OUTLINE_SOURCES)[number];

export const OUTLINE_WEAK_KINDS = [
  "overlap",
  "filler",
  "profile-fill",
] as const;
export type OutlineWeakKind = (typeof OUTLINE_WEAK_KINDS)[number];

/* Title sits a little past COPY_TARGETS.title (32) because the user types
   it; the point matches ANGLE_MAX so a planned point always fits back in. */
export const OUTLINE_LIMITS = {
  titleChars: 40,
  pointChars: 200,
  idChars: 40,
} as const;

/* Planning an outline is one brief read and one model call, no render and
   no quota, so its limit sits above design-generate's 15 an hour: a user
   re-plans while choosing a count. */
export const OUTLINE_RATE_LIMIT = { limit: 30, windowSeconds: 3600 } as const;

/** Why code thinks a point will make a weak frame. Advisory: the user can
 *  still generate with it. */
export interface OutlineWeak {
  kind: OutlineWeakKind;
  /** One sentence the user can act on, in plain words. */
  reason: string;
  /** The id of the earlier point this one repeats; only on "overlap". */
  overlapsWith?: string;
}

/** One frame's point, as the outline step shows it. */
export interface OutlinePoint {
  /** Stable across edits; the server mints "p1".."pN", the client mints
   *  its own for a point the user adds. */
  id: string;
  role: FrameRole;
  /** Two to four words, as FrameBeat.title. */
  title: string;
  /** What the frame says, as one plain sentence. */
  point: string;
  source: OutlineSource;
  /** The brief facts this point states, in the brief's words. */
  facts: string[];
  weak: OutlineWeak | null;
  /** The server's signature over the planned words and their source
   *  (outline-sign.ts). Sent back untouched with an unedited point, so its
   *  source survives the round trip; an edited point's no longer matches
   *  and its words become the owner's. */
  sig: string;
}

/** What POST /api/design/outline answers with. */
export interface PlannedOutline {
  kind: SequenceKind;
  /** Always points.length. */
  frameCount: number;
  /** In frame order: hook first, cta last. */
  points: OutlinePoint[];
  /** What the brief offers, in its words; the hook names it. */
  offering: string | null;
  /** Every hard brief fact, in the brief's words, so the UI can show
   *  which ones a deletion leaves unstated. */
  facts: string[];
}

/** One point as the client sends it back. `source` is advisory only: the
 *  server recomputes it (validateApprovedOutline), keeping a planned
 *  point's source only where `sig` still matches its words. */
export type ApprovedOutlinePoint = Pick<
  OutlinePoint,
  "id" | "role" | "title" | "point" | "source"
> & { sig?: string };

/** What POST /api/design/generate accepts as `approvedOutline`. */
export interface ApprovedOutline {
  kind: SequenceKind;
  points: ApprovedOutlinePoint[];
}

export type OutlineRule =
  | "shape"
  | "kind"
  | "count"
  | "hook-first"
  | "cta-last"
  | "cta-only-last"
  | "id"
  | "id-repeat"
  | "empty"
  | "too-long"
  | "markup"
  | "injection";

export interface OutlineProblem {
  /** Zero-based point index; null for a problem of the outline as a whole. */
  point: number | null;
  rule: OutlineRule;
  detail: string;
}
