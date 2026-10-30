import type { FrameBeat, ReplanFrameInput } from "./contract";

/** A new beat for one frame of an existing plan: the user's edits as
 *  written, or a model rewrite distinct from its neighbours. */
export async function replanFrame(
  _input: ReplanFrameInput,
): Promise<{ beat: FrameBeat; modelCalls: number }> {
  throw new Error("replanFrame: not implemented (KOOS-AI-002 U1)");
}
