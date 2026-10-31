import type { DesignSpec } from "@/lib/design/spec";
import {
  type BriefFact,
  type CoverKind,
  factStated,
} from "@/lib/jobs/directions/brief-facts";
import {
  contentStems,
  isNearDuplicateHeadline,
} from "@/lib/jobs/directions/text-overlap";
import type { FrameRole, SequenceKind } from "./contract";
import { isStatFigure, settleFrameLayouts } from "./layouts";
import {
  briefPoints,
  type ProfilePoint,
  profilePoints,
  textStatesPrice,
} from "./points";
import type { ArcAnswer } from "./schema";
import { cleanTitle } from "./title";

/**
 * The arc a set is written to, settled before any copy: exactly one claim
 * per frame, each tied to its source, no two the same point.
 *
 * Code builds the pool of points the set may make (the brief's own
 * clauses, the brief facts that are a point on their own, the brand
 * profile's clauses), a model call ranks them and assigns one to each
 * frame, and code holds the assignment to distinctness: a point that
 * overlaps one already placed is replaced by the strongest unused one.
 * The copy is then written per claim and may state only its own.
 */

/** A frame's role is its position: the hook opens, the call to action
 *  closes, everything between carries one point. */
export function roleOf(index: number, count: number): FrameRole {
  if (index === 0) return "hook";
  return index === count - 1 ? "cta" : "body";
}

/* "value" is a profile clause that states a belief rather than a fact
   about the offering: a frame built on one reads as filler beside frames
   built on what it is, how it is made and what the reader gets. */
export type PointSource = "brief" | "fact" | "profile" | "value" | "user";

/** One claim a frame may make. */
export interface ArcPoint {
  source: PointSource;
  /** The claim in its source's own words. */
  text: string;
  /** Zero-based indexes of the brief facts the claim states. */
  facts: number[];
}

/* Facts that make a frame's point on their own ("12 places", "first
   session free"). A date, a place or a contact is how and when to act,
   which the action frame carries, and so is a price that is what acting
   costs (actionPrices); a deck's other figures are slides' points. */
const CLAIM_KINDS = new Set<CoverKind>([
  "quantity",
  "offer",
  "condition",
  "age",
  "person",
]);

/* Words around a deck's figure that make it the ask, what saying yes
   costs the reader, rather than a result or the business's own pricing:
   "raising $600,000", "the ₦5m package", "we need ₦6m". "Farmers pay
   ₦500 per crate" is how the business earns, a slide's point. */
const ASKING =
  /\b(?:rais(?:e|es|ed|ing)|ask(?:s|ing)?|seek(?:s|ing)?|need(?:s|ed)?|requir(?:e|es|ed|ing)|invest(?:ment|ing|ors?)?|sponsor\w*|packages?|fund(?:s|ed|ing|raising)?|round)\b/i;

const sentencesOf = (text: string) =>
  text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());

/**
 * Zero-based indexes of the prices the action frame states: every price
 * of a carousel, and a deck's price where the brief's sentence holding it
 * asks for it or names what saying yes costs. A deck's revenue or market
 * figure stays a slide's point. A price the brief's words do not hold
 * verbatim is the action's.
 */
export function actionPrices(
  facts: readonly BriefFact[],
  kind: SequenceKind,
  briefText: string,
): Set<number> {
  return new Set(
    facts.flatMap((fact, n) => {
      if (fact.kind !== "price") return [];
      if (kind === "carousel") return [n];
      const holding = sentencesOf(briefText).filter((s) =>
        s.toLowerCase().includes(fact.text.toLowerCase()),
      );
      return holding.length === 0 || holding.some((s) => ASKING.test(s))
        ? [n]
        : [];
    }),
  );
}

/* Facts two claims may both mention and still make different points: two
   frames can each happen at the venue. */
const LOGISTICS = new Set<CoverKind>([
  "date",
  "day",
  "time",
  "place",
  "contact",
  "product",
]);

const isClaimFact = (
  fact: BriefFact,
  n: number,
  kind: SequenceKind,
  atAction: ReadonlySet<number>,
) =>
  CLAIM_KINDS.has(fact.kind) ||
  (kind === "presentation" && fact.kind === "price" && !atAction.has(n));

/* A claim sharing this many content words with another, or half of the
   shorter one's (two at least), makes that claim's point again. */
const OVERLAP_STEMS = 3;
const OVERLAP_SHARE = 0.5;
/* One shared word is a shared subject, not a shared point ("Pour one at
   the bar" beside "poured over ice"); a near-duplicate wording of a short
   claim is still caught by isNearDuplicateHeadline. */
const MIN_SHARED = 2;

/** Whether two claims, in any words, make one point: near-duplicate
 *  wording, or a large share of the same content words. `free` holds the
 *  words every frame may share (the brand's and the offering's names). */
export function textsOverlap(
  a: string,
  b: string,
  free: ReadonlySet<string> = new Set(),
): boolean {
  if (!a.trim() || !b.trim()) return false;
  if (isNearDuplicateHeadline(a, b, free)) return true;
  const sa = contentStems(a, free);
  const sb = contentStems(b, free);
  const smaller = Math.min(sa.size, sb.size);
  if (smaller === 0) return false;
  const shared = [...sa].filter((s) => sb.has(s)).length;
  return (
    shared >= OVERLAP_STEMS ||
    (shared >= MIN_SHARED && shared / smaller >= OVERLAP_SHARE)
  );
}

/** Whether two points are one: they share a fact that is a point on its
 *  own, or their words overlap (textsOverlap) beyond the logistics both
 *  may mention. */
export function claimsOverlap(
  a: Pick<ArcPoint, "text" | "facts">,
  b: Pick<ArcPoint, "text" | "facts">,
  facts: readonly BriefFact[],
  free: ReadonlySet<string> = new Set(),
): boolean {
  const pointFact = (n: number) =>
    facts[n] !== undefined && !LOGISTICS.has(facts[n].kind);
  if (a.facts.some((n) => pointFact(n) && b.facts.includes(n))) return true;
  const logistics = new Set([
    ...free,
    ...facts
      .filter((f) => LOGISTICS.has(f.kind))
      .flatMap((f) => [...contentStems(f.text)]),
  ]);
  return textsOverlap(a.text, b.text, logistics);
}

export interface PoolInput {
  facts: readonly BriefFact[];
  briefText: string;
  brand: Parameters<typeof profilePoints>[0] & {
    targetAudience?: string | null;
  };
  kind: SequenceKind;
  free: ReadonlySet<string>;
  /** The points the set needs (the hook's and each middle frame's): a
   *  pool with fewer also offers its audience and logistics. */
  slots?: number;
  /** Prices the action frame states (actionPrices), never a point. */
  atAction?: ReadonlySet<number>;
}

/* What the brief says about the piece itself ("Pitch deck for our seed
   round") is the request, not a point to make. */
const NAMES_THE_PIECE =
  /^(?:a|an|our|the|this)?\s*(?:[\p{L}-]+\s+){0,2}(?:deck|carousel|presentation|slides?|post|reel|flyer|poster)\s+(?:for|about|on|to)\b/iu;
const ABOUT_THE_PIECE =
  /\b(?:deck|carousel|slides?|presentation|post|reel|flyer|poster)\b/i;
/* How to act is the action frame's job: a clause that is the action
   ("reserve a bottle", "Book on WhatsApp") made a middle frame ask for it
   too, and the set closed three times. */
const THE_ACTION =
  /^(?:to\s+)?(?:book|order|reserve|call|whatsapp|dm|message|email|contact|sign\s+up|register|visit|buy|shop|apply|join|rsvp|enrol|enroll|text|grab|get\s+yours)\b/i;
/* Words that announce rather than say anything ("Launch our cold brew at
   our Yaba bar"). */
const ANNOUNCING = new Set(
  ["launch", "new", "introducing", "stock", "back", "now", "available"].map(
    (w) => [...contentStems(w)][0] ?? w,
  ),
);

/** Whether a brief clause or fact is a point a frame can make: not the
 *  request itself, not the action, and saying something beyond the names
 *  and facts every frame may give. */
function makesAPoint(
  text: string,
  facts: readonly BriefFact[],
  free: ReadonlySet<string>,
): boolean {
  if (THE_ACTION.test(text.trim())) return false;
  const named = new Set([
    ...free,
    ...ANNOUNCING,
    ...facts
      .filter((f) => LOGISTICS.has(f.kind))
      .flatMap((f) => [...contentStems(f.text)]),
  ]);
  const own = contentStems(text, named);
  if (NAMES_THE_PIECE.test(text.trim())) return false;
  if (ABOUT_THE_PIECE.test(text) && own.size < 4) return false;
  const opening = [...contentStems(text.split(/\s+/)[0] ?? "")][0];
  if (opening && ANNOUNCING.has(opening) && own.size < 3) return false;
  return (
    own.size >= 2 ||
    facts.some((f) => CLAIM_KINDS.has(f.kind) && f.text === text)
  );
}

const capitalisedFirst = (text: string) =>
  text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;

/* The part of a sentence on the far side of `fact` from the ask: "We are
   raising $1.2M seed to build 14 more grids" says what the money builds
   after its price. Its joining word goes with the ask. */
function besideAsk(sentence: string, ask: BriefFact): string | null {
  const at = sentence.toLowerCase().indexOf(ask.text.toLowerCase());
  if (at < 0) return null;
  const sides = [
    sentence.slice(at + ask.text.length),
    sentence.slice(0, at),
  ].map((side) =>
    side
      .replace(/^[\s,;:–—-]*(?:to|and|so|for|which|that)?\s+/i, "")
      .replace(/[\s,;:–—-]+$/, "")
      .replace(/\b(?:we\s+are|we're)\s+(?:raising|asking\s+for)\s*$/i, "")
      .trim(),
  );
  return sides.find((side) => side.split(/\s+/).length >= 2) ?? null;
}

/**
 * The brief's facts that are a point on their own, each in the sentence
 * the brief gives it in: "Customers pay ₦150 per kWh against ₦420 for
 * diesel" is one point, where its two prices alone were two bare slides
 * that only made sense together (O1 round-1 critic, HIGH 3 and 4). A
 * sentence that is the action ("Contact Ngozi Ade, ngozi@…") gives no
 * point: the person named there is how to act, not a slide. A sentence
 * that also holds the ask gives the part beside it. A fact no sentence
 * holds is offered in its own words, as before.
 */
export function factPoints({
  facts,
  briefText,
  kind,
  atAction,
}: Pick<PoolInput, "facts" | "briefText" | "kind"> & {
  atAction: ReadonlySet<number>;
}): ArcPoint[] {
  const factsIn = (text: string) =>
    facts.flatMap((f, n) =>
      f.kind !== "product" && factStated(f, text) ? [n] : [],
    );
  const sentences = sentencesOf(briefText).map((s) =>
    s.trim().replace(/[.!]+$/, ""),
  );
  const isAction = (sentence: string) =>
    THE_ACTION.test(sentence) ||
    facts.some((f) => f.kind === "contact" && factStated(f, sentence));
  const points: ArcPoint[] = [];
  const grouped = new Map<number, number[]>();
  facts.forEach((fact, n) => {
    if (!isClaimFact(fact, n, kind, atAction)) return;
    /* A price beside a rival price ("₦150 per kWh against ₦420 for
       diesel") is not read as stated, by design; its sentence still
       holds it word for word. */
    const at = sentences.findIndex(
      (s) =>
        factStated(fact, s) ||
        s.toLowerCase().includes(fact.text.toLowerCase()),
    );
    if (at < 0) {
      points.push({ source: "fact", text: fact.text, facts: [n] });
      return;
    }
    grouped.set(at, [...(grouped.get(at) ?? []), n]);
  });
  for (const [at, own] of [...grouped].sort(([a], [b]) => a - b)) {
    const sentence = sentences[at];
    if (isAction(sentence)) continue;
    const ask = [...atAction].find((n) => factStated(facts[n], sentence));
    const text = ask === undefined ? sentence : besideAsk(sentence, facts[ask]);
    const holds = (n: number) =>
      text?.toLowerCase().includes(facts[n].text.toLowerCase()) ?? false;
    /* Every fact the sentence gives word for word is this point's,
       "by end of 2027" with "14 more grids", so code never draws it onto
       another slide (O1 round-1 critic, MEDIUM 9). */
    const held = facts.flatMap((f, n) =>
      f.kind !== "product" && f.kind !== "contact" && holds(n) ? [n] : [],
    );
    const stated = text
      ? [...new Set([...factsIn(text), ...held])].sort((a, b) => a - b)
      : [];
    if (text && own.every((n) => stated.includes(n))) {
      points.push({
        source: "fact",
        text: capitalisedFirst(text),
        facts: stated.filter((n) => !atAction.has(n)),
      });
      continue;
    }
    for (const n of own) {
      points.push({ source: "fact", text: facts[n].text, facts: [n] });
    }
  }
  return points;
}

/**
 * Every distinct point the set may make, the brief's first: its own
 * clauses, then its facts that are a point on their own and no clause
 * already makes, then the brand profile's clauses (Oluwaseyi, 2026-10-30:
 * a thin brief borrows from the profile, never invents). A candidate that
 * overlaps an earlier one is the same point and is left out, as is the
 * request itself and the action. A pool still short of the frames offers,
 * last, who the offering is for (the profile's audience, said once) and
 * where and when to come in the brief's words, as one point.
 */
export function pointPool({
  facts,
  briefText,
  brand,
  kind,
  free,
  slots = 0,
  atAction = new Set(),
}: PoolInput): ArcPoint[] {
  const factsIn = (text: string) =>
    facts.flatMap((f, n) =>
      f.kind !== "product" && factStated(f, text) ? [n] : [],
    );
  const candidates: ArcPoint[] = [
    ...briefPoints(briefText, facts).map((text) => ({
      source: "brief" as const,
      text,
      facts: factsIn(text),
    })),
    ...factPoints({ facts, briefText, kind, atAction }),
    ...profilePoints(brand, briefText)
      .sort(
        (a, b) => Number(a.field === "values") - Number(b.field === "values"),
      )
      .map((p: ProfilePoint) => ({
        source:
          p.field === "values" ? ("value" as const) : ("profile" as const),
        text: p.text,
        facts: factsIn(p.text),
      })),
  ].filter(
    (c) =>
      !c.facts.some((n) => atAction.has(n)) &&
      (c.source === "profile" ||
        c.source === "value" ||
        makesAPoint(c.text, facts, free)),
  );
  const pool: ArcPoint[] = [];
  for (const candidate of candidates) {
    if (!pool.some((p) => claimsOverlap(p, candidate, facts, free))) {
      pool.push(candidate);
    }
  }
  /* Who it is for and where and when read as padding beside a real
     point, so they are offered only to a pool short of the frames. */
  const short = () => pool.length < slots;
  const audience = brand.targetAudience?.trim();
  if (short() && audience) {
    /* "For Women 25-45" reads as a title; a name or code ("SS3 students")
       keeps its capital. */
    const lead = /^\p{Lu}\p{Ll}/u.test(audience)
      ? `${audience[0].toLowerCase()}${audience.slice(1)}`
      : audience;
    pool.push({ source: "profile", text: `For ${lead}`, facts: [] });
  }
  const ofKinds = (kinds: readonly CoverKind[]) =>
    kinds.flatMap((kind) =>
      facts.flatMap((f, n) => (f.kind === kind ? [n] : [])),
    );
  const where = ofKinds(["place"]);
  /* A carousel's hook carries the date it happens (HOOK_NEWS), so a frame
     built on that date would make the hook's point again; a pool short of
     the frames gives the date a frame of its own instead of a frame with
     no point. */
  const hookHasTheDate =
    kind === "carousel" && slots >= 2 && pool.length >= slots;
  const when = ofKinds(
    hookHasTheDate ? ["day", "time"] : ["day", "date", "time"],
  );
  /* Where and when are one point to a reader: split over two frames they
     read as housekeeping padded out to fill the set. A fact a point
     already gives is that point's, not padding's. */
  const given = new Set(pool.flatMap((p) => p.facts));
  const logistics = [...where, ...when].filter((n) => !given.has(n));
  if (short() && logistics.length > 0) {
    pool.push({
      source: "fact",
      text: logistics.map((n) => facts[n].text).join(", "),
      facts: logistics,
    });
  }
  return pool;
}

/** Pool index pairs ("i,j", both orders) that share a subject. A reader
 *  hears two points on one subject as one point made twice, whatever
 *  their words. */
export function subjectPairs(
  subjects: readonly { points: readonly number[] }[],
  idOf: (n: number | undefined) => number | null,
): Set<string> {
  const pairs = new Set<string>();
  for (const subject of subjects) {
    const ids = [
      ...new Set(
        subject.points.map(idOf).filter((i): i is number => i !== null),
      ),
    ];
    for (const i of ids) {
      for (const j of ids) if (i !== j) pairs.add(`${i},${j}`);
    }
  }
  return pairs;
}

export interface ArcFrame {
  role: FrameRole;
  title: string;
  /** What the frame says, as a plain sentence; empty on the action frame,
   *  whose job is how to act, and on a frame no point was left for. */
  claim: string;
  /** Zero-based index into the pool, or null. */
  point: number | null;
  /** Zero-based indexes of the brief facts this frame states. */
  facts: number[];
  layout: DesignSpec["layout"];
  showsImage: boolean;
}

export interface ArcReplacement {
  frame: number;
  /** Zero-based pool indexes, or null for none. */
  from: number | null;
  to: number | null;
}

export interface ArcSettlement {
  frames: ArcFrame[];
  /** Body frames whose assigned point was missing, used twice or
   *  overlapping another frame's, and what replaced it. */
  replaced: ArcReplacement[];
  /** Why the hook's own angle was not used, or null when it was. */
  angleDropped: string | null;
  /** Body frames no unused point was left for. */
  unsourced: number[];
  /** Body frames given the unused point closest to distinct, every
   *  distinct one being spent. */
  crowded: number[];
  /** Pool index pairs ("i,j", both orders) the model listed under one
   *  subject. */
  sameAs: ReadonlySet<string>;
  layoutsChanged: number;
}

export interface SettleArcOptions {
  pool: readonly ArcPoint[];
  facts: readonly BriefFact[];
  kind: SequenceKind;
  /** Index of the offering's own fact, which the hook carries. */
  offeringFact: number | null;
  hasImage: boolean;
  recentLayouts?: readonly string[];
  free?: ReadonlySet<string>;
  /** Prices the action frame states (actionPrices). */
  atAction?: ReadonlySet<number>;
  /** The owner approved the outline (rubric Addendum A): frame k makes
   *  pool point k as assigned, never swapped for a distinct one, since the
   *  owner chose those points; the hook's claim is its point as given. */
  fixed?: boolean;
  /** The action frame's claim when the owner approved one; "" otherwise,
   *  as the action's job is how to act. */
  actionClaim?: string;
}

/* What the hook never carries in a carousel of three frames or more: the
   name and where to find it is a label, not a reason to swipe. */
const OFF_HOOK = new Set<CoverKind>(["time", "place", "contact"]);
/* The date it happens is the news a reader swipes for ("Saturday 15
   November: launch day"), so a carousel's hook carries it beside its
   reason, and the action frame says how to act on it. Days of the week
   alone ("Tuesday to Saturday") are opening days, the action's to give:
   on the hook they read as store hours (outline round 2 judge, textile). */
const HOOK_NEWS = new Set<CoverKind>(["date"]);

/**
 * The model's assignment, held to the rules no copy is needed to check:
 *  - roles come from position;
 *  - the hook's claim is its angle, unless the angle gives a carousel's
 *    price (which belongs beside the action), when it is the hook's point
 *    in its source's words;
 *  - each body frame's point is one no earlier frame (the hook's angle and
 *    point included) already makes, by its words (claimsOverlap) or by the
 *    model's own reading of which points are one (two points it lists
 *    under one subject); one that is missing, used twice or overlapping
 *    is replaced by the next unused point in the model's ranking, then in
 *    the pool's order, and with none left by the closest (see closest);
 *  - each fact is stated once, on the frame whose point holds it; the
 *    offering on the hook, a carousel's prices and every fact no point
 *    holds on the action frame; in a carousel of three frames or more the
 *    day it happens on the hook as its news, and no time, place or contact;
 *  - layouts are settled by settleFrameLayouts; titles are proposals,
 *    settled against the written copy (withSettledTitles).
 */
export function settleArc(
  answer: Pick<ArcAnswer, "frames" | "hookAngle" | "spare"> &
    Partial<Pick<ArcAnswer, "subjects">>,
  {
    pool,
    facts,
    kind,
    offeringFact,
    hasImage,
    recentLayouts = [],
    free = new Set(),
    atAction = new Set(),
    fixed = false,
    actionClaim = "",
  }: SettleArcOptions,
): ArcSettlement {
  const count = answer.frames.length;
  const last = count - 1;
  const idOf = (n: number | undefined) => {
    const i = (n ?? 0) - 1;
    return Number.isInteger(i) && i >= 0 && i < pool.length ? i : null;
  };
  const actionPriced = (text: string) =>
    [...atAction].some((n) => textStatesPrice(facts[n], text));

  const hookPoint = idOf(answer.frames[0]?.point);
  const sourceText = hookPoint === null ? "" : pool[hookPoint].text;
  const angle = answer.hookAngle.trim();
  let angleDropped: string | null = null;
  let hookClaim = angle;
  if (!angle) {
    angleDropped = "no angle was given";
    hookClaim = sourceText;
  } else if (!fixed && actionPriced(angle)) {
    angleDropped = "the angle gives the price, which the action frame carries";
    hookClaim = sourceText;
  }

  const sameAs = subjectPairs(answer.subjects ?? [], idOf);
  const used = new Set<number>(hookPoint === null ? [] : [hookPoint]);
  const placed: Pick<ArcPoint, "text" | "facts">[] =
    hookPoint === null ? [] : [pool[hookPoint]];
  /* The angle is the model's own sentence and says more words around its
     point than a listed point does, so a point is the angle's when most of
     the point's own words are in it ("each piece is one of a kind" in an
     angle that ends on it), not when it shares one. */
  const angleTakes = (i: number) => {
    if (!hookClaim || hookClaim === sourceText) return false;
    if (isNearDuplicateHeadline(hookClaim, pool[i].text, free)) return true;
    const said = contentStems(hookClaim, free);
    const theirs = [...contentStems(pool[i].text, free)];
    const shared = theirs.filter((s) => said.has(s)).length;
    return (
      shared >= OVERLAP_STEMS ||
      (shared >= MIN_SHARED && shared / theirs.length >= OVERLAP_SHARE)
    );
  };
  const ranking = [
    ...answer.spare.map(idOf),
    ...answer.frames.map((f) => idOf(f.point)),
    ...pool.map((_, i) => i),
  ].filter((i, k, all): i is number => i !== null && all.indexOf(i) === k);
  const fits = (i: number | null): i is number =>
    i !== null &&
    !used.has(i) &&
    ![...used].some((u) => sameAs.has(`${u},${i}`)) &&
    !angleTakes(i) &&
    !placed.some((p) => claimsOverlap(p, pool[i], facts, free));
  /* With every distinct point spent, a frame still takes a sourced point
     rather than none, where the writer would pad: the unused one on the
     subject fewest frames already make, then sharing the fewest words. */
  const closest = (): number | null => {
    const unused = ranking.filter(
      (i) =>
        !used.has(i) &&
        !placed.some((p) =>
          isNearDuplicateHeadline(p.text, pool[i].text, free),
        ),
    );
    if (unused.length === 0) return null;
    const subjectsShared = (i: number) =>
      [...used].filter((u) => sameAs.has(`${u},${i}`)).length;
    const wordsShared = (i: number) => {
      const mine = contentStems(pool[i].text, free);
      return placed.reduce(
        (n, p) =>
          n + [...contentStems(p.text, free)].filter((s) => mine.has(s)).length,
        0,
      );
    };
    const cost = (i: number) => subjectsShared(i) * 100 + wordsShared(i);
    return unused.reduce((best, i) => (cost(i) < cost(best) ? i : best));
  };

  const replaced: ArcReplacement[] = [];
  const unsourced: number[] = [];
  const crowded: number[] = [];
  const points: (number | null)[] = answer.frames.map((frame, i) => {
    if (i === 0) return hookPoint;
    if (i === last) return null;
    const assigned = idOf(frame.point);
    if (fixed) {
      if (assigned === null) unsourced.push(i);
      else used.add(assigned);
      return assigned;
    }
    let chosen = fits(assigned) ? assigned : (ranking.find(fits) ?? null);
    if (chosen === null) {
      chosen = closest();
      if (chosen !== null) crowded.push(i);
    }
    if (chosen !== assigned) {
      replaced.push({ frame: i, from: assigned, to: chosen });
    }
    if (chosen === null) {
      unsourced.push(i);
      return null;
    }
    used.add(chosen);
    placed.push(pool[chosen]);
    return chosen;
  });

  const owner = new Map<number, number>();
  const own = (n: number, frame: number) => {
    if (!owner.has(n)) owner.set(n, frame);
  };
  if (offeringFact !== null) own(offeringFact, 0);
  const onBodies = new Set(
    points.flatMap((point, frame) =>
      point === null || frame === 0 || frame === last ? [] : pool[point].facts,
    ),
  );
  if (kind === "carousel" && count >= 3) {
    facts.forEach((f, n) => {
      if (HOOK_NEWS.has(f.kind) && !onBodies.has(n)) own(n, 0);
    });
  }
  points.forEach((point, frame) => {
    if (point === null) return;
    for (const n of pool[point].facts) {
      const fact = facts[n];
      if (atAction.has(n)) continue;
      if (fact.kind === "contact") continue;
      if (
        frame === 0 &&
        kind === "carousel" &&
        count >= 3 &&
        OFF_HOOK.has(fact.kind)
      ) {
        continue;
      }
      own(n, frame);
    }
  });
  for (let n = 0; n < facts.length; n += 1) own(n, last);

  const claims = points.map((point, i) => {
    if (i === 0) return hookClaim;
    if (i === last) return actionClaim.trim();
    return point === null ? "" : pool[point].text;
  });
  const roles = answer.frames.map((_, i) => roleOf(i, count));
  const titles = answer.frames.map((frame) => cleanTitle(frame.title));
  const factsOf = (frame: number) =>
    facts.flatMap((_, n) => (owner.get(n) === frame ? [n] : []));
  const shows = answer.frames.map(
    (frame, i) => hasImage && (i === 0 || frame.showsImage),
  );
  const layouts = settleFrameLayouts(
    answer.frames.map((frame, i) => ({
      layout: frame.layout,
      showsImage: shows[i],
      figure: factsOf(i).some((n) => isStatFigure(facts[n].text)),
    })),
    recentLayouts,
    { panel: !hasImage },
  );
  const frames: ArcFrame[] = answer.frames.map((_, i) => ({
    role: roles[i],
    title: titles[i],
    claim: claims[i],
    point: points[i],
    facts: factsOf(i),
    layout: layouts[i],
    showsImage: shows[i],
  }));
  return {
    frames,
    replaced,
    angleDropped,
    unsourced,
    crowded,
    sameAs,
    layoutsChanged: answer.frames.filter((f, i) => f.layout !== layouts[i])
      .length,
  };
}

/** Unused points of the pool that overlap no frame's claim, best first by
 *  the arc's ranking: what a frame takes when its own point cannot be
 *  written without repeating another frame. */
export function sparePoints(
  arc: ArcSettlement,
  pool: readonly ArcPoint[],
  facts: readonly BriefFact[],
  free: ReadonlySet<string> = new Set(),
): number[] {
  const used = arc.frames.flatMap((f) => (f.point === null ? [] : [f.point]));
  return pool.flatMap((point, i) =>
    !used.includes(i) &&
    !used.some((u) => arc.sameAs.has(`${u},${i}`)) &&
    !arc.frames.some(
      (f) =>
        f.claim &&
        claimsOverlap({ text: f.claim, facts: f.facts }, point, facts, free),
    )
      ? [i]
      : [],
  );
}
