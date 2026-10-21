/**
 * Whether the design-training system shapes the prompts.
 *
 * Two reasons this exists rather than the feature simply being on:
 *
 * 1. The benchmark (KOOS-AI-001 deliverable #8) has to run the same brief with
 *    and without the training system in one process. Comparing against a git
 *    checkout is not a comparison anyone can re-run.
 * 2. It is the rollback. If the training system makes output worse for a
 *    brand, this turns it off without a deploy — and the alternative, reverting
 *    prompts under pressure, is how prompt changes get made badly.
 *
 * On unless explicitly turned off. A flag defaulting to off would let the
 * feature look shipped while doing nothing, which is the failure the approach
 * document opens with.
 */

const OFF_VALUES = new Set(["off", "false", "0", "no"]);

export function designTrainingEnabled(override?: boolean): boolean {
  if (typeof override === "boolean") return override;
  const configured = (process.env.AI_DESIGN_TRAINING ?? "")
    .trim()
    .toLowerCase();
  return !OFF_VALUES.has(configured);
}
