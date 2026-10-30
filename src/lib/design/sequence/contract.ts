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
}

export interface PlanSequenceResult {
  plan: PlannedSequence;
  /** Problems still standing after the one repair pass; the job decides
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
}

/** The frame fields SerializedGeneration carries; null on single designs. */
export interface SerializedFrame {
  setId: string;
  index: number;
  count: number;
  role: FrameRole;
  title: string;
}
