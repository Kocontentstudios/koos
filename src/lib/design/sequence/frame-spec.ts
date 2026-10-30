import type { DesignSpec } from "@/lib/design/spec";
import type { PlannedSequence } from "./contract";

/** One frame of a plan as the ordinary single-frame spec the renderer draws,
 *  with the set's shared palette, logo and footer system. Pure. */
export function frameSpec(_plan: PlannedSequence, _index: number): DesignSpec {
  throw new Error("frameSpec: not implemented (KOOS-AI-002 U1)");
}
