import {
  type BriefFact,
  drawnText,
  factStated,
  numbersIn,
} from "@/lib/jobs/directions/brief-facts";
import { contentStems } from "@/lib/jobs/directions/text-overlap";
import type { FrameBeat } from "./contract";
import type { FrameRepeat } from "./repeats";
import { frameCopy } from "./validate";

/* Words a headline may add to the fact before it says something of its
   own: "Only 12 places" is still the count alone. */
const FACT_ONLY_SLACK = 1;

/* Every fact a middle frame can stand on alone with nothing said about
   it. Round 2 named the receipt kinds (price, offer, count, condition);
   round 4's critic named the rest: "Launches on 3 March", a bare venue or
   date frame, read as a holding slide in every set that had one. A place
   or a date with a word of its own ("Pour one at our Yaba bar") is a
   point, which FACT_ONLY_SLACK allows. A contact is the action frame's. */
const STANDALONE_KINDS = new Set<BriefFact["kind"]>([
  "price",
  "offer",
  "quantity",
  "condition",
  "date",
  "day",
  "time",
  "place",
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
      (f) => STANDALONE_KINDS.has(f.kind) && factStated(f, headline),
    );
    if (!fact) return [];
    const said = contentStems(fact.text);
    const beyond = [...contentStems(beat.headline)].filter((s) => !said.has(s));
    if (beyond.length > FACT_ONLY_SLACK) return [];
    return [
      {
        frame,
        detail: `its headline only gives "${fact.text}", a bare detail with nothing on what it buys or why it matters to the reader; add a subheadline, from the brief or the brand profile, that says so`,
      },
    ];
  });
}

/** The brand-profile fields a thin brief may borrow a frame's point from
 *  (Oluwaseyi, 2026-10-30): its statements of what is true. primaryGoal is
 *  not one: a goal is what the business wants, and round 4 shipped goals
 *  as achieved facts ("First-time buyers become monthly reorders" for
 *  "Turn first-time buyers into monthly reorders"). targetAudience is not
 *  one either: round 5's judge marked down every frame built on it as the
 *  set describing its reader twice ("Frames 5 and 6 both address the same
 *  three audiences"); who the set is for shapes every frame's words
 *  through the system prompt instead. Ordered by what a
 *  viewer acts on: what sets the brand apart before what it says about
 *  itself. sequenceLedger reads these fields as the brief's own sources,
 *  so a point drawn from one is never counted as invented. */
export const PROFILE_POINT_FIELDS = [
  "differentiators",
  "offer",
  "values",
  "overview",
] as const;
export type ProfilePointField = (typeof PROFILE_POINT_FIELDS)[number];

export interface ProfilePoint {
  field: ProfilePointField;
  text: string;
}

/* Share of a profile clause's content words already said (by the brief or
   an earlier clause) past which it is not a new point. Tuning set, school
   deck: values ("no cost") and differentiators ("at no cost to families")
   became three slides the judge read as one. */
const SAID_SHARE = 0.5;

/* A clause needs this many content words to be a point of its own;
   shorter, it is read with the clause before it ("roasted in-house" alone
   says nothing a frame can stand on). */
const CLAUSE_WORDS = 2;

/** A field's statements, one per clause: "Full-grain leather, hand-stitched
 *  soles, free resole in year one" is three points a thin set can spend on
 *  three frames, rather than one a frame states whole and the next pads
 *  around (round-4 critic, LOW 8: "Exactly what you want at lunch."). */
export function profileClauses(text: string): string[] {
  const clauses: string[] = [];
  for (const raw of text.split(/\s*(?:;|,(?=\s)|\.(?=\s|$)|\s[-–—]\s)\s*/)) {
    const clause = raw.trim();
    if (!clause) continue;
    if (contentStems(clause).size < CLAUSE_WORDS && clauses.length > 0) {
      clauses[clauses.length - 1] = `${clauses[clauses.length - 1]}, ${clause}`;
      continue;
    }
    clauses.push(clause);
  }
  return clauses;
}

/** The profile's points a frame may make once the brief's own are spent.
 *  A clause the brief already mostly says is the brief's point, not a
 *  second source, and two clauses mostly saying one thing are one point. */
export function profilePoints(
  brand: Partial<Record<ProfilePointField, string | null>>,
  briefText: string,
): ProfilePoint[] {
  const brief = contentStems(briefText);
  const points: ProfilePoint[] = [];
  const said: Set<string>[] = [];
  for (const field of PROFILE_POINT_FIELDS) {
    for (const text of profileClauses(brand[field]?.trim() ?? "")) {
      const stems = contentStems(text);
      if (stems.size === 0) continue;
      const share = (known: ReadonlySet<string>) =>
        [...stems].filter((s) => known.has(s)).length / stems.size;
      if (share(brief) > SAID_SHARE) continue;
      if (said.some((earlier) => share(earlier) > SAID_SHARE)) continue;
      said.push(stems);
      points.push({ field, text });
    }
  }
  return points;
}

/** The brief's own points besides its hard facts, one per clause: what
 *  it says the offering does, how it is made, who it is for. A clause that
 *  is only facts and the offering's name ("₦2,500 a bottle", "Launch our
 *  cold brew at our Yaba bar") is the fact list's. Numbered for the outline
 *  so each middle frame is built on one source no other frame uses: the
 *  round-4 judge's repeats were two frames drawing on one brief sentence
 *  ("steeped slow" on the hook, "steeped for 18 hours" on frame 2). */
export function briefPoints(
  briefText: string,
  facts: readonly BriefFact[],
): string[] {
  const named = new Set(facts.flatMap((f) => [...contentStems(f.text)]));
  return profileClauses(briefText.replace(/\s+/g, " ").trim()).filter(
    (clause) =>
      [...contentStems(clause)].filter((s) => !named.has(s)).length >=
      CLAUSE_WORDS,
  );
}

/** The profile's own words for what is true of the brand: the sources a
 *  profile point is held to. */
export function profileStatements(
  brand: Partial<Record<ProfilePointField, string | null>>,
): string[] {
  return PROFILE_POINT_FIELDS.flatMap((field) => {
    const text = brand[field]?.trim();
    return text ? [text] : [];
  });
}

/* A price's amount, the way a reader finds it whatever words are around
   it: round 4's critic got "Priced at ₦32,000", "Just ₦32,000" and
   "₦32,000 this December" past a check that wanted the brief's whole
   "₦32,000 a pair". A unit's number ("a 10kg bag") is not the amount. */
const AMOUNT =
  /(?:[₦$£€]|\bNGN\s?|\bN(?=\d))\s?(\d[\d,]*(?:\.\d+)?\s?k?)\b|(\d[\d,]*(?:\.\d+)?\s?k?)\s?(?:naira|ngn)\b/gi;

export function priceAmounts(price: BriefFact): Set<string> {
  const amounts = new Set<string>();
  for (const m of price.text.matchAll(AMOUNT)) {
    for (const n of numbersIn(m[1] ?? m[2] ?? "")) amounts.add(n);
  }
  return amounts;
}

/** Whether `beat` gives the price's amount, in any words. */
export function statesPrice(price: BriefFact, beat: FrameBeat): boolean {
  const amounts = priceAmounts(price);
  if (amounts.size === 0) return factStated(price, beat);
  const said = numbersIn(drawnText(frameCopy(beat)));
  return [...amounts].some((n) => said.has(n));
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
      .filter((price) => statesPrice(price, beat))
      .map((price) => ({
        frame,
        detail: `it gives the price "${price.text}", which belongs on frame ${last} beside the action; leave the price out of this frame`,
      }));
  });
}
