import { z } from "zod";

/**
 * Choosing between versions the model wrote: two drafts of the whole set's
 * copy, or several versions of its hook. Latent work on purpose: what
 * separates them is whether the hook pulls and whether the frames build,
 * which eval rounds 1 to 11 showed no word count can tell (the judge's hook
 * and non-repetition averages held between 3.2 and 3.8 whatever code
 * checked). Choosing writes no word of any version: code may choose, never
 * invent.
 *
 * Code still decides first. Only versions tied for the fewest problems
 * (planScore) go to the editor: a version that breaks a rule, invents a
 * fact or repeats a line another does not loses without a model call.
 */

/* Two, not three: round 2 measured three drafts with the editor choosing
   among any within two faults of the best, and the full matrix's
   non-repetition average fell (3.61 to 3.44) while copy faults left rose
   (18 to 24). A fault code can name is one the judge marks down too. */
export const COPY_DRAFTS = 2;

export function choiceResponseSchema(count: number) {
  return z.object({
    why: z
      .string()
      .max(800)
      .describe("One or two sentences: what the chosen one does better."),
    choice: z
      .number()
      .int()
      .min(1)
      .max(count)
      .describe("The number of the one that goes out."),
  });
}

export type ChoiceAnswer = z.infer<ReturnType<typeof choiceResponseSchema>>;

/** The indexes of the versions tied for the fewest problems, in order. */
export function leastProblems(scores: readonly number[]): number[] {
  const best = Math.min(...scores);
  return scores.flatMap((s, i) => (s === best ? [i] : []));
}

/**
 * The order the editor sees `count` versions in, as indexes into the order
 * they were written: shuffled, so a preference for the first-shown version
 * never becomes a preference for the first-written one (the current hook,
 * the first draft). `random` is injectable for tests.
 */
export function shownOrder(count: number, random = Math.random): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** The written index of the version the editor numbered `choice`
 *  (1-based, in the order shown). */
export function chosenIndex(choice: number, order: readonly number[]): number {
  return order[choice - 1] ?? order[0];
}
