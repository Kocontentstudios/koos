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

/** The brand-profile fields a thin brief may borrow a frame's point from
 *  (Oluwaseyi, 2026-10-30): its statements of fact, the ones brandFacts
 *  puts in the claim ledger, so a point drawn from one is never counted
 *  as invented. Ordered by what a viewer acts on: what sets the brand
 *  apart before what it says about itself. */
export const PROFILE_POINT_FIELDS = [
  "differentiators",
  "offer",
  "values",
  "targetAudience",
  "primaryGoal",
  "overview",
] as const;
export type ProfilePointField = (typeof PROFILE_POINT_FIELDS)[number];

export interface ProfilePoint {
  field: ProfilePointField;
  text: string;
}

/* Share of a profile field's content words already said (by the brief or
   an earlier field) past which it is not a new point. Run u1r4-a: a
   school deck's values ("no cost") and differentiators ("at no cost to
   families") became three slides the judge read as one. */
const SAID_SHARE = 0.5;

/** The profile's points a frame may make once the brief's own are spent.
 *  A field the brief already mostly says is the brief's point, not a
 *  second source, and two fields mostly saying one thing are one point. */
export function profilePoints(
  brand: Partial<Record<ProfilePointField, string | null>>,
  briefText: string,
): ProfilePoint[] {
  const brief = contentStems(briefText);
  const points: ProfilePoint[] = [];
  const said: Set<string>[] = [];
  for (const field of PROFILE_POINT_FIELDS) {
    const text = brand[field]?.trim();
    if (!text) continue;
    const stems = contentStems(text);
    if (stems.size === 0) continue;
    const share = (known: ReadonlySet<string>) =>
      [...stems].filter((s) => known.has(s)).length / stems.size;
    if (share(brief) > SAID_SHARE) continue;
    if (said.some((earlier) => share(earlier) > SAID_SHARE)) continue;
    said.push(stems);
    points.push({ field, text });
  }
  return points;
}

/* A carousel's price answers "what does acting cost", so it sits beside
   the action. The outline places it there (settleOutline priceWithAction),
   but the copy writer can still state it on a frame the outline did not
   give it (round-3 critic, textile N=5: "₦18,000 for a 2-yard piece" set
   as a middle frame's stat), so the written set is checked again. */
export function misplacedPrices(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
  kind: "carousel" | "presentation",
): FrameRepeat[] {
  if (kind !== "carousel" || frames.length < 2) return [];
  const last = frames.length;
  const prices = facts.filter((f) => f.kind === "price");
  return frames.flatMap((beat, frame) => {
    if (beat.role === "cta") return [];
    return prices
      .filter((price) => factStated(price, beat))
      .map((price) => ({
        frame,
        detail: `it gives the price "${price.text}", which belongs on frame ${last} beside the action; leave the price out of this frame`,
      }));
  });
}
