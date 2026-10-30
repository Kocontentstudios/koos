import { type BriefFact, factStated } from "@/lib/jobs/directions/brief-facts";
import { contentStems } from "@/lib/jobs/directions/text-overlap";
import type { FrameBeat } from "./contract";
import type { FrameRepeat } from "./repeats";

/* Words a headline may add to the fact before it says something of its
   own: "Only 12 places" is still the count alone. */
const FACT_ONLY_SLACK = 1;

/* The facts a reader cannot act on or care about alone. A place or a date
   standing as the headline is where and when ("Pour one at our Yaba bar"),
   which is a point. */
const RECEIPT_KINDS = new Set<BriefFact["kind"]>([
  "price",
  "offer",
  "quantity",
  "condition",
]);

/**
 * Middle frames whose whole copy is one brief fact: a headline that only
 * gives the price, offer or count, with no subheadline saying what it buys
 * or why it matters. Round-2 critic: every five-frame carousel had one
 * ("₦2,500 a Bottle", "₦18,000 for a 2-yard piece", "Free for your first 3
 * months"), and the judge called it "a receipt stub where a slide should
 * be". The hook and the action frame have their own jobs and checks.
 *
 * Not a contract rule: the frame is drawable. The edit pass is asked for
 * the line, and code never writes one.
 */
export function factOnlyFrames(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
): FrameRepeat[] {
  return frames.flatMap((beat, frame) => {
    if (beat.role !== "body" || beat.subheadline.trim()) return [];
    const headline = {
      headline: beat.headline,
      subheadline: "",
      cta: "",
      footerLines: [],
    };
    const fact = facts.find(
      (f) => RECEIPT_KINDS.has(f.kind) && factStated(f, headline),
    );
    if (!fact) return [];
    const said = contentStems(fact.text);
    const beyond = [...contentStems(beat.headline)].filter((s) => !said.has(s));
    if (beyond.length > FACT_ONLY_SLACK) return [];
    return [
      {
        frame,
        detail: `its headline only gives "${fact.text}", a receipt line with nothing on what it buys or why it matters; add a subheadline, from the brief or the brand profile, that says so`,
      },
    ];
  });
}
