import { z } from "zod";

/**
 * Choosing between whole versions of the set the model wrote: its drafts,
 * then the edited set under each new opening. Latent work
 * on purpose: whether a hook pulls and whether the frames build is what no
 * word count can tell, so the editor grades each version rather than
 * naming a favourite. Choosing writes no word of any version.
 *
 * Code still decides first: only the versions with the fewest hard
 * problems (plan.ts hardScore) are graded, so a version that breaks a
 * rule, drops a fact or invents a term never wins on taste.
 */

/* Three drafts, graded whole (gradedIndex). Round 2 measured three with
   the editor picking among any within two faults of the best and lost
   ground; there the editor named a favourite without reading for repeats,
   and versions with more faults were eligible. Here only the versions
   tied on what code can measure are graded, each read for repeats first. */
export const COPY_DRAFTS = 3;

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

/* Room for an eight-frame set's every pair; a note cut short would fail
   the whole grade over its length. */
export const GRADE_NOTE_MAX = 1500;

/** The editor's read of each version shown: the points it finds made
 *  twice, then a score for the opening, the build and the close. */
export function gradeResponseSchema(count: number) {
  return z.object({
    grades: z
      .array(
        z.object({
          version: z.number().int().describe("The version's number, as shown."),
          repeats: z
            .string()
            .max(GRADE_NOTE_MAX)
            .describe(
              'Every pair of frames that make one point or share a phrase, named by number with a few words each, or "none".',
            ),
          hook: z.number().int().min(1).max(5),
          builds: z.number().int().min(1).max(5),
          action: z.number().int().min(1).max(5),
        }),
      )
      .min(count)
      .max(count),
  });
}

export type GradeAnswer = z.infer<ReturnType<typeof gradeResponseSchema>>;

/** The editor's scores by written index (the order `shownOrder` gave),
 *  null for a version it did not grade. */
export function gradesByIndex(
  answer: GradeAnswer,
  order: readonly number[],
): (number | null)[] {
  const totals: (number | null)[] = order.map(() => null);
  for (const grade of answer.grades) {
    const index = order[grade.version - 1];
    if (index === undefined || totals[index] !== null) continue;
    totals[index] = grade.hook + grade.builds + grade.action;
  }
  return totals;
}

/**
 * The version that goes out. Code decides what it can measure: only the
 * versions with the fewest broken rules, invented words and missing facts
 * (`hard`) are eligible. Among those the editor's grade decides, since
 * whether a hook pulls and a set builds is what no count of words can tell;
 * a tie, or a version the editor did not grade, goes to the fewest copy
 * faults code found (`soft`), then the first written.
 */
export function gradedIndex(
  hard: readonly number[],
  soft: readonly number[],
  grades: readonly (number | null)[],
): number {
  const eligible = leastProblems(hard);
  return eligible.reduce((best, i) => {
    const [gi, gb] = [grades[i] ?? -1, grades[best] ?? -1];
    if (gi !== gb) return gi > gb ? i : best;
    return soft[i] < soft[best] ? i : best;
  });
}

/** The editor's "repeats" note for each version, by written index; null
 *  for one it did not grade or found none in. */
export function notesByIndex(
  answer: GradeAnswer,
  order: readonly number[],
): (string | null)[] {
  const notes: (string | null)[] = order.map(() => null);
  for (const grade of answer.grades) {
    const index = order[grade.version - 1];
    const note = grade.repeats.trim();
    if (index === undefined || notes[index] !== null) continue;
    if (note && !/^none\b/i.test(note)) notes[index] = note;
  }
  return notes;
}
