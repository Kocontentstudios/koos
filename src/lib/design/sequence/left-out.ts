import type { FrameBeat, LeftOutFrame } from "./contract";
import { pointKeptOnSet } from "./outline-arc";

/**
 * Why a frame the last stand dropped is not in the set, said truthfully:
 * a frame whose line became the hook's headline, or whose point another
 * slide still makes, was merged, not lost. Telling the owner "we couldn't
 * word it" while its words open the set is false (integration round 2,
 * HIGH 1).
 */
export function whereItLives(
  frames: readonly FrameBeat[],
  promoted: boolean,
  point: string,
  free: ReadonlySet<string>,
): Pick<LeftOutFrame, "reason" | "keptOn"> {
  if (promoted) return { reason: "merged", keptOn: 0 };
  if (!point.trim()) return { reason: "fault" };
  const on = frames.findIndex((f) => pointKeptOnSet([f], point, free));
  if (on >= 0) return { reason: "merged", keptOn: on };
  return pointKeptOnSet(frames, point, free)
    ? { reason: "merged" }
    : { reason: "fault" };
}
