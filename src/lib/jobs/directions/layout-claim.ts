import type { DesignSpec } from "@/lib/design/spec";
import { layoutsHeld } from "./layouts";
import { LayoutsHeldError } from "./subject-layout";

interface SetRow {
  id: string;
  status: string;
  spec: unknown;
  rationale: unknown;
  createdAt: Date;
}

/* Each lost claim means another job settled a layout in this set while
   this one chose; a pair has two slots, so a third loss is a set being
   regenerated faster than it can settle. */
const MAX_ATTEMPTS = 3;

/**
 * Chooses a direction's layout with no lock held, then claims it with a
 * short conditional write (claimDirectionLayout), choosing again from the
 * set as it now is when another job claimed first. No database transaction
 * is open while documents are built.
 */
export async function settleDirectionLayout<C extends { spec: DesignSpec }>({
  self,
  readSet,
  choose,
  claim,
  now = () => new Date(),
}: {
  self: { id: string; set: string; slot: number; replacing?: string | null };
  /** The set as committed, read without a lock. */
  readSet: () => Promise<SetRow[]>;
  /** Builds candidates and picks one; throws LayoutsHeldError with none
   *  free. */
  choose: (held: string[]) => Promise<C>;
  /** Writes the chosen spec if `isFree` holds under the set's lock. */
  claim: (
    spec: DesignSpec,
    isFree: (rows: SetRow[]) => boolean,
  ) => Promise<boolean>;
  now?: () => Date;
}): Promise<C> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const held = layoutsHeld(await readSet(), self, now());
    const choice = await choose(held);
    const layout = choice.spec.layout;
    const claimed = await claim(
      choice.spec,
      (rows) => !layoutsHeld(rows, self, now()).includes(layout),
    );
    if (claimed) return choice;
  }
  throw new LayoutsHeldError();
}
