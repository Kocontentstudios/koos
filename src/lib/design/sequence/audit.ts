import { contentStems } from "@/lib/jobs/directions/text-overlap";
import type { FrameBeat } from "./contract";
import { type Flag, stillSays } from "./faults";
import type { AuditAnswer } from "./schema";

/* Share of a flagged statement's content words the brief and profile
   already hold, past which the audit misread a sourced detail. */
const SOURCED_SHARE = 0.75;

/** The audit's answer as findings code can hold the set to: repeats by
 *  zero-based frame (later first, the hook never the later one), and
 *  unsourced statements that are on the frame as written and that the
 *  sources do not mostly say. */
export function auditFlags(
  audit: Pick<AuditAnswer, "repeats" | "unsourced"> &
    Partial<Pick<AuditAnswer, "restated">>,
  frames: readonly FrameBeat[],
  sources: string,
): Flag[] {
  const known = contentStems(sources);
  const repeats = audit.repeats.flatMap(({ frame, sameAs }): Flag[] => {
    const [earlier, later] = [frame - 1, sameAs - 1].sort((a, b) => a - b);
    const beat = frames[later];
    if (!beat || !frames[earlier] || earlier === later || later === 0) {
      return [];
    }
    return [
      {
        kind: "repeat",
        frame: later,
        sameAs: earlier,
        headline: beat.headline,
      },
    ];
  });
  const unsourced = audit.unsourced.flatMap(({ frame, text }): Flag[] => {
    const beat = frames[frame - 1];
    const stems = [...contentStems(text)];
    const sourced =
      stems.length > 0 &&
      stems.filter((s) => known.has(s)).length / stems.length >= SOURCED_SHARE;
    return beat && text.trim() && !sourced && stillSays(beat, text)
      ? [{ kind: "unsourced", frame: frame - 1, text: text.trim() }]
      : [];
  });
  const restated = (audit.restated ?? []).flatMap((n): Flag[] => {
    const beat = frames[n - 1];
    return beat?.role === "body" && beat.subheadline.trim()
      ? [{ kind: "restated", frame: n - 1, subheadline: beat.subheadline }]
      : [];
  });
  const once = new Set<string>();
  return [...repeats, ...unsourced, ...restated].filter((flag) => {
    const key = `${flag.kind}:${flag.frame}`;
    if (flag.kind !== "unsourced" && once.has(key)) return false;
    once.add(key);
    return true;
  });
}
