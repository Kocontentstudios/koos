import type { BrandSummary } from "@/lib/ai/prompts/strategy";
import {
  type BriefFact,
  factStated,
  numbersIn,
} from "@/lib/jobs/directions/brief-facts";
import { contentStems } from "@/lib/jobs/directions/text-overlap";
import { type ArcPoint, claimsOverlap, textsOverlap } from "./arc";
import type { ApprovedOutline, FrameBeat } from "./contract";
import type { CopyFault } from "./faults";
import { EMPTY_POINT, factsIn } from "./outline-arc";
import { PROFILE_POINT_FIELDS, profileClauses } from "./points";

/**
 * What the owner took out of an outline (O5: nothing from a deleted point
 * appears). Not sending a point is not enough: the copy model still reads
 * the brand profile and the whole brief, and wrote "taught by a working
 * software engineer" onto a frame after the owner deleted that point. So
 * code names what was removed, takes it out of the profile the model
 * reads, and finds and cuts it on the set, footers and button included.
 */

/** The points the planner would offer that no approved point makes:
 *  every pool point the owner deleted or replaced. None when the outline
 *  comes back as planned (outlineEdited). */
export function removedPoints(
  outline: ApprovedOutline,
  pool: readonly ArcPoint[],
  facts: readonly BriefFact[],
  free: ReadonlySet<string> = new Set(),
): ArcPoint[] {
  /* Approved as planned, the pool points the planner left unused were
     never the owner's to take out: they are spare, and a frame may still
     be given one in place of a point another frame makes. */
  if (!outlineEdited(outline)) return [];
  const approved = outline.points.map((p) => ({
    text: p.point,
    facts: factsIn(p.point, facts),
  }));
  return pool.filter(
    (candidate) =>
      candidate.text.trim() &&
      !approved.some((a) => claimsOverlap(a, candidate, facts, free)),
  );
}

/** The removed points the copy model still reads in the brief, which it
 *  must be told to leave out; a profile point is taken out of the profile
 *  it reads instead, and naming it would put it back in front of it. */
export const removedFromBrief = (removed: readonly ArcPoint[]): string[] =>
  removed
    .filter((p) => p.source === "brief" || p.source === "fact")
    .map((p) => p.text);

/** The brand profile without the clauses the owner removed, for every
 *  prompt the set's copy is written from. */
export function profileWithout(
  brand: BrandSummary,
  removed: readonly string[],
  free: ReadonlySet<string> = new Set(),
): BrandSummary {
  if (removed.length === 0) return brand;
  const next: BrandSummary = { ...brand };
  for (const field of PROFILE_POINT_FIELDS) {
    const text = brand[field]?.trim();
    if (!text) continue;
    const kept = profileClauses(text).filter(
      (clause) => !removed.some((r) => textsOverlap(clause, r, free)),
    );
    next[field] = kept.length > 0 ? kept.join("; ") : null;
  }
  return next;
}

const SENTENCE_BREAK = /(?<=[.!?])\s+(?=\S)/;

/* faults.ts's MAJOR: setFaults imports this module, so the weight is not
   imported back. */
const BLOCKING = 3;

/** The removed point a line makes, unless the frame's own point makes it
 *  too (an owner's point may share words with what it replaced). */
export function removedSaidBy(
  line: string,
  removed: readonly string[],
  own: string,
  free: ReadonlySet<string>,
): string | null {
  if (!line.trim()) return null;
  return (
    removed.find(
      (r) => textsOverlap(line, r, free) && !textsOverlap(line, own, free),
    ) ?? null
  );
}

/** Every line of a frame a reader sees, footer items and the button
 *  included: a removed point drawn in small print is still said. */
export function linesOf(beat: FrameBeat): string[] {
  return [
    beat.headline,
    ...beat.subheadline.split(SENTENCE_BREAK),
    ...beat.footerLines.flatMap((line) => line.split(FOOTER_ITEM)),
    beat.cta,
  ].filter((line) => line.trim());
}

const FOOTER_ITEM = /\s+·\s+/;

/** Frames that still make a point the owner took out. Blocking. */
export function removedFaults(
  frames: readonly FrameBeat[],
  removed: readonly string[],
  claims: readonly string[],
  free: ReadonlySet<string>,
): CopyFault[] {
  if (removed.length === 0) return [];
  return frames.flatMap((beat, frame) => {
    const own = claims[frame] ?? "";
    const said = linesOf(beat)
      .map((line) => removedSaidBy(line, removed, own, free))
      .find((r): r is string => r !== null);
    return said
      ? [
          {
            frame,
            field: "frame" as const,
            detail: `it says a point the owner took out ("${said}"); say only this frame's own claim`,
            weight: BLOCKING,
          },
        ]
      : [];
  });
}

/** `line` with a released fact's own words taken out, with the comma or
 *  joining word that held them, or "" when nothing readable is left. */
export function withoutFactText(line: string, fact: BriefFact): string {
  if (!factStated(fact, line)) return line;
  const words = fact.text.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:\\s*[,;·–—-]\\s*|\\s+(?:and|in|at|on|for)\\s+)?${words}(?:\\s*[,;·–—-]\\s*)?`,
    "i",
  );
  const cut = line
    .replace(pattern, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;·–—-]+|[\s,;·–—-]+$/g, "")
    .trim();
  return cut && !factStated(fact, cut) && /\p{L}{2}/u.test(cut) ? cut : "";
}

/** Frames that say a held point (heldPoints) the frame's own approved
 *  point does not make. Blocking, like a removed point. */
export function heldFaults(
  frames: readonly FrameBeat[],
  held: readonly { text: string; frames: readonly number[] }[],
  claims: readonly string[],
  free: ReadonlySet<string>,
): CopyFault[] {
  if (held.length === 0) return [];
  return frames.flatMap((beat, frame) => {
    const others = held
      .filter((h) => !h.frames.includes(frame))
      .map((h) => h.text);
    const own = claims[frame] ?? "";
    const said = linesOf(beat)
      .map((line) => removedSaidBy(line, others, own, free))
      .find((r): r is string => r !== null);
    return said
      ? [
          {
            frame,
            field: "frame" as const,
            detail: `it says what the owner left to another slide ("${said}"); say only this frame's own claim`,
            weight: BLOCKING,
          },
        ]
      : [];
  });
}

/**
 * Whether the outline is not the one the planner sent: a point the owner
 * wrote, or a planned point missing (ids are planned in order, p1 to pN,
 * and the hook and action cannot be deleted, so a deletion leaves a gap).
 */
export function outlineEdited(outline: ApprovedOutline): boolean {
  /* An "Add a point" slide the planner left is not the owner's writing:
     an outline that only has those comes back as planned. */
  return outline.points.some(
    (p, i) =>
      (p.source === "user" && p.point.trim() !== EMPTY_POINT) ||
      p.id !== `p${i + 1}`,
  );
}

const MONEY =
  /[₦$£€]\s?\d|\b\d[\d,.]*\s?(?:naira|k)\b|\bN\d|\bNGN\s?\d|\bUSD\s?\d/i;
/* "₦300 off your next one" takes money off; it prices nothing. */
const MONEY_OFF =
  /\b(?:save|saves|saving|discount|rebate|cashback)\b|[\d,.]+k?\s+(?:off|less)\b/i;
const CALENDAR_WORD =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i;
const CLOCK = /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b\d{1,2}:\d{2}\b/i;
/* Share of a price's item words ("silk press") the owner's words must
   give for their price to be for the same thing: "Each laptop costs
   ₦200,000" does not reprice "We need ₦6,000,000 for 30 laptops". */
const SAME_ITEM_SHARE = 0.6;

const sharesFigure = (text: string, fact: BriefFact) => {
  const given = numbersIn(text);
  return [...numbersIn(fact.text)].some((n) => given.has(n));
};

/**
 * Whether the owner's words change a fact rather than leave it out or say
 * it again, read by the fact's kind so a figure that only happens to be
 * shared is no correction ("A 2-yard piece is enough for a gown" says
 * nothing of "₦18,000 for a 2-yard piece"; "Reminders go out 3 days
 * before" says nothing of "3 March"):
 *  - a date or day: they give a day or month and share a figure with it;
 *  - a time: they give a clock time and share a figure with it;
 *  - a price: they give money, not money off, for the same item;
 *  - anything else: they share a figure and a word with it and give a
 *    figure of their own ("5 to 8 seats" over "6 seats" does not count).
 */
export function correctsFact(text: string, fact: BriefFact): boolean {
  if (factStated(fact, text) || numbersIn(fact.text).size === 0) return false;
  switch (fact.kind) {
    case "date":
    case "day":
      return CALENDAR_WORD.test(text) && sharesFigure(text, fact);
    case "time":
      return CLOCK.test(text) && sharesFigure(text, fact);
    case "price": {
      if (!MONEY.test(text) || MONEY_OFF.test(text)) return false;
      /* "Each laptop costs ₦200,000" prices one laptop, not the brief's
         "₦6,000,000 for 30 laptops": a price for a counted lot is only
         corrected by words that give the same count. */
      const given = numbersIn(text);
      const lot = [...numbersIn(fact.text)].filter(
        (n) => !moneyAmounts(fact.text).has(n),
      );
      if (lot.some((n) => !given.has(n))) return false;
      const item = [...contentStems(fact.text)].filter((w) => !/\d/.test(w));
      const theirs = contentStems(text);
      const shared = item.filter((w) => theirs.has(w)).length;
      return item.length > 0 && shared / item.length >= SAME_ITEM_SHARE;
    }
    default: {
      if (!sharesFigure(text, fact)) return false;
      const own = [...numbersIn(text)].filter(
        (n) => !numbersIn(fact.text).has(n),
      );
      const words = [...contentStems(fact.text)].filter((w) => !/\d/.test(w));
      const theirs = contentStems(text);
      return own.length > 0 && words.some((w) => theirs.has(w));
    }
  }
}

/**
 * The brief facts the owner took out, by index: facts no approved point
 * states that a point the owner deleted or replaced carried, or that the
 * owner's own words correct. H5 asks every brief fact on some frame; O5
 * says nothing the owner removed appears. The approved outline is the
 * owner's decision, so O5 wins: these facts are neither required nor
 * drawn by code, and a frame that states one is at fault. An outline the
 * owner did not touch releases nothing, so the planner's own outline is
 * held to every fact.
 */
export function releasedFacts(
  outline: ApprovedOutline,
  planned: readonly ArcPoint[],
  facts: readonly BriefFact[],
  free: ReadonlySet<string> = new Set(),
): number[] {
  if (!outlineEdited(outline)) return [];
  const approved = outline.points.map((p) => ({
    text: p.point,
    facts: factsIn(p.point, facts),
    owner: p.source === "user",
  }));
  const stated = new Set(approved.flatMap((a) => a.facts));
  const owners = approved.filter((a) => a.owner);
  const removed = removedPoints(outline, planned, facts, free);
  return facts.flatMap((fact, n) => {
    if (fact.kind === "product") return [];
    /* An owner's correction outranks a planned point that still gives the
       old figure ("₦16,500" on a body point while the action's point
       says "₦18,000"): the set would otherwise state both. */
    if (owners.some((o) => correctsFact(o.text, fact))) return [n];
    if (stated.has(n) || approved.some((a) => givesWords(fact, a.text))) {
      return [];
    }
    /* The planned outline places every hard fact on a point
       (withEveryFactPlaced), so one no approved point states left with a
       point the owner deleted or rewrote. Reading it off the pool instead
       missed a point the outline wrote in other words than the pool's
       ("Farmers pay ₦500 per crate per day."), and the fact was drawn
       back onto the action. A price whose amount an approved point still
       gives is that point's, in its words ("₦450,000 a month" for "5
       desks"). */
    if (fact.kind === "price" && givesAmount(fact, approved)) return [];
    if (!LOGISTICS_KINDS.has(fact.kind)) return [n];
    /* A when or where is often said in other words than the brief's
       ("starts 10 January" for "From 10 January"): released only with
       the point that carried it. */
    const carried = planned.filter((p) => p.facts.includes(n));
    const dropped = carried.some(
      (p) =>
        removed.includes(p) ||
        owners.some((o) => claimsOverlap(o, p, facts, free)),
    );
    return dropped ? [n] : [];
  });
}

/* A fact a point gives in its own words, read loosely so a strict read
   that misses it ("ready in 3 days" beside "₦3,000") never releases
   what the owner kept: the fact's words as they are, or every figure and
   content word of it. */
function givesWords(fact: BriefFact, text: string): boolean {
  if (flatWords(text).includes(flatWords(fact.text))) return true;
  const figures = numbersIn(fact.text);
  const given = numbersIn(text);
  const words = contentStems(fact.text);
  const theirs = contentStems(text);
  return (
    words.size > 0 &&
    [...figures].every((f) => given.has(f)) &&
    [...words].every((w) => theirs.has(w))
  );
}

const LOGISTICS_KINDS = new Set<BriefFact["kind"]>([
  "date",
  "day",
  "time",
  "place",
  "contact",
]);

const givesAmount = (
  price: BriefFact,
  approved: readonly { text: string }[],
) => {
  const amounts = moneyAmounts(price.text);
  return (
    amounts.size > 0 &&
    approved.some((a) => {
      const given = moneyAmounts(a.text);
      return [...amounts].every((n) => given.has(n));
    })
  );
};

const MONEY_AMOUNT =
  /(?:[₦$£€]|\bNGN\s?|\bN(?=\d))\s?(\d[\d,]*(?:\.\d+)?\s?(?:k|m|million)?)\b/gi;

function moneyAmounts(text: string): Set<string> {
  const amounts = new Set<string>();
  for (const m of text.matchAll(MONEY_AMOUNT)) {
    for (const n of numbersIn(m[1])) amounts.add(n);
  }
  return amounts;
}

/**
 * Fact homes with each price moved to the approved point that gives its
 * amount, when the frame planned to carry it does not: in a deck the
 * owner edited, "₦450,000 a month" is the hook's point, and the same
 * price on the action's footer says again the point the owner rewrote.
 * A carousel's price stays beside the action (misplacedPrices).
 */
export function pricesOnTheirPoints(
  owners: readonly (readonly number[])[],
  outline: ApprovedOutline | null,
  facts: readonly BriefFact[],
): number[][] {
  const homes = owners.map((o) => [...o]);
  if (outline?.kind !== "presentation" || !outlineEdited(outline)) {
    return homes;
  }
  homes.forEach((owned, frame) => {
    for (const n of [...owned]) {
      const fact = facts[n];
      if (fact?.kind !== "price") continue;
      const own = outline.points[frame]?.point ?? "";
      if (givesAmount(fact, [{ text: own }])) continue;
      const home = outline.points.findIndex((p) =>
        givesAmount(fact, [{ text: p.point }]),
      );
      if (home < 0 || home === frame || !homes[home]) continue;
      homes[frame] = homes[frame].filter((m) => m !== n);
      homes[home].push(n);
    }
  });
  return homes;
}

/**
 * Planned points an edited outline still makes, each with the frames
 * whose approved point makes it. The owner who rewrote "Team plan
 * ₦450,000 a month for 5 desks" into another point left its price to
 * the hook that also gives it; the same words on the action's footer
 * are the rewritten point said again, not the hook's.
 */
export function heldPoints(
  outline: ApprovedOutline,
  pool: readonly Pick<ArcPoint, "text" | "facts">[],
  facts: readonly BriefFact[],
  free: ReadonlySet<string> = new Set(),
  briefText = "",
): { text: string; frames: number[] }[] {
  if (!outlineEdited(outline)) return [];
  const approved = outline.points.map((p) => ({
    text: p.point,
    facts: factsIn(p.point, facts),
  }));
  /* The brief's own sentences too: the outline may have carried one in
     the brief's words, not the pool's ("Gold partner package
     ₦15,000,000." on the action's point). */
  const sentences = (briefText ?? "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim().replace(/[.!?]$/, ""))
    .filter((s) => s.split(/\s+/).length >= 3)
    .map((text) => ({ text, facts: factsIn(text, facts) }));
  const seen = new Set<string>();
  return [...pool, ...sentences].flatMap((candidate) => {
    const key = flatWords(candidate.text);
    if (seen.has(key)) return [];
    seen.add(key);
    if (!candidate.text.trim()) return [];
    const frames = approved.flatMap((a, i) =>
      claimsOverlap(a, candidate, facts, free) ? [i] : [],
    );
    /* A point the approved words give as they are is that frame's own
       claim, already held by every repeat check. */
    const verbatim = approved.some(
      (a) => flatWords(a.text) === flatWords(candidate.text),
    );
    return frames.length > 0 && !verbatim
      ? [{ text: candidate.text, frames }]
      : [];
  });
}

const flatWords = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** The brief's sentences that give a fact the owner took out, as removed
 *  points: the outline may have carried the fact in the brief's words
 *  rather than the pool's, so the sentence is what a frame would say. */
export function releasedSentences(
  briefText: string,
  facts: readonly BriefFact[],
  released: readonly string[],
  outline: ApprovedOutline,
  free: ReadonlySet<string> = new Set(),
): string[] {
  const gone = facts.filter(
    (f) => released.includes(f.text) && !LOGISTICS_KINDS.has(f.kind),
  );
  if (gone.length === 0) return [];
  return briefText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s &&
        gone.some((f) => factStated(f, s)) &&
        !facts.some(
          (f) =>
            !released.includes(f.text) &&
            f.kind !== "product" &&
            factStated(f, s),
        ) &&
        !outline.points.some((p) => textsOverlap(s, p.point, free)),
    );
}

/** The released facts a frame may not state. A claim the owner took out
 *  never; a figure the owner corrected never. A where or when may still
 *  be said (the hook dates its news, the action says where to go) unless
 *  the frame's own point already gives one of its kind: the action whose
 *  point says "Drop off at Plot 12 Aminu Kano Crescent" has its where,
 *  and the "Wuse 2" of the deleted "studio in Wuse 2" says that point
 *  again. */
export function unsayable(
  facts: readonly BriefFact[],
  released: readonly string[],
  owned: readonly string[] = [],
  claim = "",
): BriefFact[] {
  const ownKinds = new Set(
    facts
      .filter(
        (f) => !released.includes(f.text) && claim && factStated(f, claim),
      )
      .map((f) => logisticsGroup(f.kind)),
  );
  return facts.filter(
    (f) =>
      released.includes(f.text) &&
      (!LOGISTICS_KINDS.has(f.kind) ||
        owned.some((o) => o && correctsFact(o, f)) ||
        ownKinds.has(logisticsGroup(f.kind))),
  );
}

const logisticsGroup = (kind: BriefFact["kind"]) =>
  kind === "day" || kind === "time" ? "date" : kind;

/** Frames that state a fact the owner took out (releasedFacts). Blocking:
 *  the brief still holds it, so the copy model may write it anyway. */
export function releasedFaults(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
  released: readonly string[],
  owned: readonly string[] = [],
  claims: readonly string[] = [],
): CopyFault[] {
  if (released.length === 0) return [];
  return frames.flatMap((beat, frame) => {
    const gone = unsayable(facts, released, owned, claims[frame] ?? "");
    const said = gone.find((fact) =>
      linesOf(beat).some((line) => factStated(fact, line)),
    );
    return said
      ? [
          {
            frame,
            field: "frame" as const,
            detail: `it states "${said.text}", which the owner took out of the outline; leave it out`,
            weight: BLOCKING,
          },
        ]
      : [];
  });
}
