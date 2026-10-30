import type { PlanSequenceInput, PlanSequenceResult } from "./contract";

/** One model call writes every frame; validateSequence holds it to the
 *  rules and one repair pass is asked for what it breaks. */
export async function planSequence(
  _input: PlanSequenceInput,
): Promise<PlanSequenceResult> {
  throw new Error("planSequence: not implemented (KOOS-AI-002 U1)");
}
