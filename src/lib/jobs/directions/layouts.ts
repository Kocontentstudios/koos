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

/** A pending row older than this is a job that died, not one in flight. */
export const PENDING_CLAIM_MS = 15 * 60 * 1000;

interface HeldRow {
  id: string;
  status: string;
  spec: unknown;
  rationale: unknown;
  createdAt: Date;
}

function layoutOf(row: HeldRow): string | null {
  const layout = (row.spec as { layout?: unknown } | null)?.layout;
  return typeof layout === "string" ? layout : null;
}

function slotOf(row: HeldRow, set: string): number | null {
  const stored = row.rationale as { set?: unknown; slot?: unknown } | null;
  return stored?.set === set && typeof stored.slot === "number"
    ? stored.slot
    : null;
}

/**
 * The layouts a direction in `slot` may not take, read from its set under
 * the set's lock (claimDirectionLayout): what the other slot shows (its
 * newest succeeded row), what another job is making for it right now (a
 * pending row newer than that), and the direction being replaced.
 */
export function layoutsHeld(
  rows: readonly HeldRow[],
  self: { id: string; set: string; slot: number; replacing?: string | null },
  now: Date,
): string[] {
  const held = new Set<string>();
  const others = rows.filter(
    (row) => row.id !== self.id && slotOf(row, self.set) !== null,
  );
  for (const row of others) {
    if (row.id === self.replacing) {
      const layout = layoutOf(row);
      if (layout) held.add(layout);
    }
  }
  const slots = new Set(others.map((row) => slotOf(row, self.set)));
  for (const slot of slots) {
    if (slot === self.slot) continue;
    const inSlot = others.filter((row) => slotOf(row, self.set) === slot);
    const shown = inSlot
      .filter((row) => row.status === "succeeded")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const shownLayout = shown ? layoutOf(shown) : null;
    if (shownLayout) held.add(shownLayout);
    for (const row of inSlot) {
      if (row.status !== "pending") continue;
      if (shown && row.createdAt <= shown.createdAt) continue;
      if (now.getTime() - row.createdAt.getTime() > PENDING_CLAIM_MS) continue;
      const layout = layoutOf(row);
      if (layout) held.add(layout);
    }
  }
  return [...held];
}

/** The order layouts are tried in for a direction: its own first, then
 *  every free one in catalogue order. */
export function layoutCandidates(
  proposed: Layout,
  held: readonly string[],
): Layout[] {
  const free = DESIGN_LAYOUTS.filter((layout) => !held.includes(layout));
  return free.includes(proposed)
    ? [proposed, ...free.filter((layout) => layout !== proposed)]
    : free;
}
