import { DESIGN_LAYOUTS, type DesignSpec } from "@/lib/design/spec";

type Layout = DesignSpec["layout"];

/**
 * The layout a direction keeps, given the layouts already taken by its
 * siblings (spec, "Generation" 1).
 *
 * The model is asked for two different layouts and usually complies, but
 * "usually" is not a guarantee the results screen can stand on: two cards in
 * the same composition read as one design drawn twice. When the proposal is
 * taken, the direction gets the first layout in catalogue order that no
 * sibling uses and recent memory does not hold, so the swap also steers away
 * from the rut the layout memory exists to break. Memory yields before
 * distinctness does: with every free layout recent, the first free one wins.
 */
export function distinctLayout(
  proposed: Layout,
  taken: readonly string[],
  recent: readonly string[],
): Layout {
  if (!taken.includes(proposed)) return proposed;
  const free = DESIGN_LAYOUTS.filter((layout) => !taken.includes(layout));
  return free.find((layout) => !recent.includes(layout)) ?? free[0] ?? proposed;
}

/** Applies distinctLayout in order, so each direction avoids every one
 *  before it plus anything the caller already holds (a regenerated
 *  direction's original and its sibling). */
export function forceDistinctLayouts(
  proposed: readonly Layout[],
  recent: readonly string[],
  alreadyTaken: readonly string[] = [],
): Layout[] {
  const taken = [...alreadyTaken];
  return proposed.map((layout) => {
    const kept = distinctLayout(layout, taken, recent);
    taken.push(kept);
    return kept;
  });
}
