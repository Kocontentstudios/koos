import type { ApprovedOutline, OutlineProblem, SequenceKind } from "./contract";

export interface OutlineValidateContext {
  /** The kind the server resolved from the brief; the client's is checked
   *  against it, never trusted. */
  kind: SequenceKind;
  briefText: string;
  /** The profile's statements (profileStatements), in their own words. */
  profileStatements: readonly string[];
}

export type OutlineValidation =
  | { ok: true; outline: ApprovedOutline }
  | { ok: false; problems: OutlineProblem[] };

/**
 * The client's approved outline, parsed with zod and held to the contract:
 * count within FRAME_BOUNDS, hook first, cta last and only last, ids
 * unique and well formed, title and point non-empty and within
 * OUTLINE_LIMITS, no markup. Text is trimmed and its whitespace collapsed.
 * Every source is recomputed: a point whose words the brief holds is
 * "brief", the profile's "profile", anything else "user", which copy treats
 * as stated. Pure.
 */
export function validateApprovedOutline(
  _raw: unknown,
  _ctx: OutlineValidateContext,
): OutlineValidation {
  throw new Error("validateApprovedOutline: not implemented");
}
