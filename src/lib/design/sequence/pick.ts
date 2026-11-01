import type { FrameBeat, PlannedSequence } from "./contract";
import {
  blockingFaults,
  type FaultRules,
  faultScore,
  hookScore,
  MAJOR,
  setFaults,
} from "./faults";

/**
 * Settles the editor's pick between two drafts of a set (buildPickPrompt).
 * A writer's own best guess at an opening, scored by code for faults, kept
 * the flattest hook whenever it was fault-free; a second draft and a cold
 * editor choose for what code cannot measure (does it earn the swipe, does
 * it build), and code only refuses a pick that leaves the set worse by its
 * own faults.
 */

export interface Draft {
  /** The draft's set, tidied, with its writer's own opening. */
  plan: PlannedSequence;
  /** The draft's openings for frame 1, its writer's own first. */
  hooks: readonly Pick<FrameBeat, "headline" | "subheadline">[];
}

export interface PickedSet {
  plan: PlannedSequence;
  draft: number;
  /** Index into every draft's hooks, in draft order. */
  hook: number;
  /** Why code did not keep the editor's pick, or null when it did. */
  overruled: string | null;
}

/* A draft the editor prefers may carry this many more blocking faults
   after frame 1 than the other: one, which the fix call and the gate are
   there to settle; more is a draft code would have to rewrite. */
const SET_SLACK = MAJOR;

const bodyScore = (plan: PlannedSequence, rules: FaultRules) =>
  faultScore(blockingFaults(setFaults(plan, rules)).filter((f) => f.frame > 0));

const withHook = (
  plan: PlannedSequence,
  hook: Pick<FrameBeat, "headline" | "subheadline">,
): PlannedSequence => ({
  ...plan,
  frames: plan.frames.map((beat, i) =>
    i === 0
      ? {
          ...beat,
          headline: hook.headline.trim(),
          subheadline: hook.subheadline.trim(),
        }
      : beat,
  ),
});

/**
 * The set to carry on with: the editor's draft unless it has more than
 * SET_SLACK more blocking faults after frame 1 than the other; then the
 * editor's opening for it when no opening scores fewer faults on frame 1
 * (hookScore), since the editor most often prefers the opening that spends
 * frame 2's point; else the best, the chosen draft's own openings first on
 * a tie. With one draft, its fewest-fault
 * opening.
 */
export function settlePick(
  drafts: readonly Draft[],
  pick: { set: number; hook: number } | null,
  rules: FaultRules,
): PickedSet {
  const reasons: string[] = [];
  let draft = pick && drafts[pick.set] ? pick.set : 0;
  if (pick && drafts.length > 1) {
    const other = 1 - draft;
    const mine = bodyScore(drafts[draft].plan, rules);
    const theirs = bodyScore(drafts[other].plan, rules);
    if (mine > theirs + SET_SLACK) {
      reasons.push(
        `draft ${draft + 1} has ${mine} blocking fault weight after frame 1, draft ${other + 1} ${theirs}`,
      );
      draft = other;
    }
  }
  const all = drafts.flatMap((d, k) => d.hooks.map((h) => ({ h, k })));
  const base = drafts[draft].plan;
  const scores = all.map(({ h }) =>
    hookScore(withHook(base, h).frames[0], base, rules),
  );
  const best = Math.min(...scores);
  const own = all.findIndex(({ k }, i) => k === draft && scores[i] === best);
  const fallback = own >= 0 ? own : scores.indexOf(best);
  let hook = fallback;
  if (pick && all[pick.hook]) {
    if (scores[pick.hook] <= best) hook = pick.hook;
    else
      reasons.push(
        `opening ${pick.hook + 1} scores ${scores[pick.hook]}, the best ${best}`,
      );
  }
  return {
    plan: withHook(base, all[hook].h),
    draft,
    hook,
    overruled: reasons.length > 0 ? reasons.join("; ") : null,
  };
}
