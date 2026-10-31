import {
  type BriefFact,
  drawnText,
  factStated,
  numbersIn,
} from "@/lib/jobs/directions/brief-facts";
import { contentStems } from "@/lib/jobs/directions/text-overlap";
import { upperFirst } from "./casing";
import type { FrameBeat } from "./contract";
import type { FrameRepeat } from "./repeats";
import { frameCopy } from "./validate";

/* Words a headline may add to the fact before it says something of its
   own: "Only 12 places" is still the count alone. */
const FACT_ONLY_SLACK = 1;

/* Every fact a middle frame can stand on alone with nothing said about
   it: the receipt kinds (price, offer, count, condition) and the holding
   slides ("Launches on 3 March", a bare venue or date). A place
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
 * or why it matters ("₦2,500 a Bottle" alone reads as a receipt stub where
 * a slide should be). The hook and the action frame have their own jobs and checks.
 *
 * Not a contract rule: the frame is drawable. The fix call is asked for
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
 *  not one: a goal is what the business wants, and drawn as a point it
 *  reads as achieved ("First-time buyers become monthly reorders").
 *  targetAudience is not one either: a frame built on it describes the
 *  reader a second time; who the set is for shapes every frame's words
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
   an earlier clause) past which it is not a new point: values ("no cost")
   and differentiators ("at no cost to families") are one point, not two
   slides. */
const SAID_SHARE = 0.5;

/* A clause needs this many content words to be a point of its own;
   shorter, it is read with the clause before it ("roasted in-house" alone
   says nothing a frame can stand on). */
const CLAUSE_WORDS = 2;

/* A clause opening on one of these qualifies the clause before it ("Spend
   your time on the work, not on chasing payment"): alone it says nothing. */
const QUALIFIES =
  /^(?:not|nor|without|so|then|which|who|whose|where|while|yet)\b/i;
/* A clause joined by one of these is a point of its own once the joining
   word is gone ("and get a reminder when a client pays late"). */
const JOINED = /^(?:and|but|plus)\s+/i;
/* The last items of a list a comma split, in lower case: one or two
   words, then "and" or "or" ("brands and buyers into one programme" after
   "Brings designers"). Alone, each half reads cut off. */
const LIST_TAIL = /^[\p{L}\p{N}'-]+(?:\s+[\p{L}\p{N}'-]+)?\s+(?:and|or|&)\s/iu;

const capitalised = upperFirst;

/** A field's statements, one per clause: "Full-grain leather, hand-stitched
 *  soles, free resole in year one" is three points a thin set can spend on
 *  three frames, rather than one a frame states whole and the next pads
 *  around. A clause too short to stand, or one that only qualifies the
 *  clause before it, is read with that clause. */
export function profileClauses(text: string): string[] {
  const clauses: string[] = [];
  const pieces = text.split(/\s*(;|,(?=\s)|\.(?=\s|$)|\s[-–—]\s)\s*/);
  for (let i = 0; i < pieces.length; i += 2) {
    const clause = pieces[i].trim();
    if (!clause) continue;
    const short = contentStems(clause).size < CLAUSE_WORDS;
    const listed = pieces[i - 1] === "," && /^\p{Ll}/u.test(clause);
    const leans =
      short || QUALIFIES.test(clause) || (listed && LIST_TAIL.test(clause));
    if (clauses.length > 0 && leans) {
      clauses[clauses.length - 1] = `${clauses[clauses.length - 1]}, ${clause}`;
      continue;
    }
    clauses.push(capitalised(clause.replace(JOINED, "")));
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
 *  cold brew at our Yaba bar") is the fact list's. Each becomes one point
 *  of the arc's pool, so no two frames draw on one brief sentence
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
   it: "Priced at ₦32,000", "Just ₦32,000" and "₦32,000 this December" all
   give the brief's "₦32,000 a pair". A unit's number ("a 10kg bag") is not the amount. */
const AMOUNT =
  /(?:[₦$£€]|\bNGN\s?|\bN(?=\d))\s?(\d[\d,]*(?:\.\d+)?\s?k?)\b|(\d[\d,]*(?:\.\d+)?\s?k?)\s?(?:naira|ngn)\b/gi;

export function priceAmounts(price: BriefFact): Set<string> {
  const amounts = new Set<string>();
  for (const m of price.text.matchAll(AMOUNT)) {
    for (const n of numbersIn(m[1] ?? m[2] ?? "")) amounts.add(n);
  }
  return amounts;
}

/** Whether `text` gives the price's amount, in any words. */
export function textStatesPrice(price: BriefFact, text: string): boolean {
  const amounts = priceAmounts(price);
  if (amounts.size === 0) return factStated(price, text);
  const said = numbersIn(text);
  return [...amounts].some((n) => said.has(n));
}

/* The words that lead into an amount and lean on it: "for", "at",
   "just" in "Your soles, sorted for ₦7,500". */
const AMOUNT_LEAD = /(?:,?\s+(?:for|at|from|just|only|of|costs?|is)){0,2}\s*$/i;

/**
 * `text` with the price's amount, and the words leading into it, taken
 * out where what is left still reads: "Your soles, sorted" of "Your soles,
 * sorted for ₦7,500". Null when the amount is not in it, fewer than two
 * words are left or the rest opens mid-sentence. Words are only removed.
 */
export function withoutAmount(text: string, price: BriefFact): string | null {
  const amounts = priceAmounts(price);
  let cut = text;
  let found = false;
  for (const m of [...text.matchAll(AMOUNT)].reverse()) {
    const value = [...numbersIn(m[1] ?? m[2] ?? "")];
    if (!value.some((n) => amounts.has(n)) || m.index === undefined) continue;
    found = true;
    const before = cut.slice(0, m.index).replace(AMOUNT_LEAD, "");
    const after = cut.slice(m.index + m[0].length);
    cut = `${before}${after}`;
  }
  if (!found) return null;
  const rest = cut
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/^[\s,;:—–-]+|[\s,;:—–-]+$/g, "")
    .trim();
  /* What opened on the amount and now opens mid-sentence ("gets your
     soles rebuilt") leans on it. */
  if (/^\p{Ll}/u.test(rest)) return null;
  return rest.split(/\s+/).filter(Boolean).length >= 2 ? rest : null;
}

/** Whether `beat` gives the price's amount, in any words. */
export function statesPrice(price: BriefFact, beat: FrameBeat): boolean {
  return textStatesPrice(price, drawnText(frameCopy(beat)));
}

/* A carousel's price answers "what does acting cost", so it sits beside
   the action. The arc places it there (settleArc), but the copy writer
   can still state it on a frame the arc did not give it, so the written
   set is checked again. */
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
