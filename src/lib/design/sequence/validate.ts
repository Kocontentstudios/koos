import type { BriefFact } from "@/lib/jobs/directions/brief-facts";
import type { PlannedSequence, SequenceProblem } from "./contract";

export interface SequenceRules {
  frameCount: number;
  facts: readonly BriefFact[];
  offering: string | null;
  /** Whether the set has an image to draw (an upload or a KO plate). */
  hasImage: boolean;
}

/** Every rule a plan breaks (contract SequenceRule). Pure; [] is a pass. */
export function validateSequence(
  _plan: PlannedSequence,
  _rules: SequenceRules,
): SequenceProblem[] {
  throw new Error("validateSequence: not implemented (KOOS-AI-002 U1)");
}
