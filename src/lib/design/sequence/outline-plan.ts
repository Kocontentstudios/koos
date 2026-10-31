import type { BriefReader } from "@/lib/jobs/directions/brief-read";
import type { PlannedOutline, PlanSequenceInput } from "./contract";

export type PlanOutlineInput = Pick<
  PlanSequenceInput,
  "context" | "kind" | "frameCount" | "memorySummary"
>;

export interface PlanOutlineDeps {
  briefReader?: BriefReader;
}

export interface PlanOutlineResult {
  /** Flagged (flagOutline) before it is returned. */
  outline: PlannedOutline;
  modelCalls: number;
  ms: number;
}

/**
 * The outline of a set: exactly frameCount points, hook first and action
 * last, each one claim in plain words with its source. Reads the brief
 * and builds the pool the way planSequence does (pointPool, settleArc), so
 * the outline and the planner agree on what a point is. No copy, no
 * render, no quota.
 */
export async function planOutline(
  _input: PlanOutlineInput,
  _deps: PlanOutlineDeps = {},
): Promise<PlanOutlineResult> {
  throw new Error("planOutline: not implemented");
}
