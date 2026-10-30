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
import { hasFigure, settleFrameLayouts } from "./layouts";
import {
  briefPoints,
  type ProfilePoint,
  profilePoints,
  textStatesPrice,
} from "./points";
import type { ArcAnswer } from "./schema";
import { cleanTitle, isCleanTitle } from "./title";

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
export type PointSource = "brief" | "fact" | "profile" | "value";

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
   which the action frame carries; a carousel's price answers what acting
   costs, so it sits there too, while a deck's figures are slides' points. */
const CLAIM_KINDS = new Set<CoverKind>([
  "quantity",
  "offer",
  "condition",
  "age",
  "person",
]);

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

const isClaimFact = (fact: BriefFact, kind: SequenceKind) =>
  CLAIM_KINDS.has(fact.kind) ||
  (kind === "presentation" && fact.kind === "price");

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

/**
 * Every distinct point the set may make, the brief's first: its own
 * clauses, then its facts that are a point on their own and no clause
 * already makes, then the brand profile's clauses (Oluwaseyi, 2026-10-30:
 * a thin brief borrows from the profile, never invents). A candidate that
 * overlaps an earlier one is the same point and is left out, as is the
 * request itself and the action. A pool still short of the frames offers,
 * last, who the offering is for (the profile's audience, said once) and
 * where and when to come in the brief's words, as two points when two are
 * still missing.
 */
export function pointPool({
  facts,
  briefText,
  brand,
  kind,
  free,
  slots = 0,
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
    ...facts.flatMap((fact, n) =>
      isClaimFact(fact, kind)
        ? [{ source: "fact" as const, text: fact.text, facts: [n] }]
        : [],
    ),
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
      c.source === "profile" ||
      c.source === "value" ||
      makesAPoint(c.text, facts, free),
  );
  const pool: ArcPoint[] = [];
  for (const candidate of candidates) {
    if (!pool.some((p) => claimsOverlap(p, candidate, facts, free))) {
      pool.push(candidate);
    }
  }
  const audience = brand.targetAudience?.trim();
  if (pool.length < slots && audience) {
    pool.push({ source: "profile", text: `For ${audience}`, facts: [] });
  }
  const ofKinds = (kinds: readonly CoverKind[]) =>
    kinds.flatMap((kind) =>
      facts.flatMap((f, n) => (f.kind === kind ? [n] : [])),
    );
  const where = ofKinds(["place"]);
  const when = ofKinds(["day", "date", "time"]);
  const short = slots - pool.length;
  const logistics =
    short >= 2 && where.length > 0 && when.length > 0
      ? [where, when]
      : short >= 1 && where.length + when.length > 0
        ? [[...where, ...when]]
        : [];
  for (const group of logistics) {
    pool.push({
      source: "fact",
      text: group.map((n) => facts[n].text).join(", "),
      facts: group,
    });
  }
  return pool;
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
  /** Pool index pairs ("i,j", both orders) the model read as one point. */
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
}

/* What the hook never carries in a carousel of three frames or more: the
   name and where to find it is a label, not a reason to swipe. */
const OFF_HOOK = new Set<CoverKind>(["time", "place", "contact"]);
/* The day it happens is the news a reader swipes for ("Saturday 15
   November: launch day"), so a carousel's hook carries it beside its
   reason, and the action frame says how to act on it. */
const HOOK_NEWS = new Set<CoverKind>(["date", "day"]);

const TITLE_STOP = new Set(["a", "an", "the", "our", "your", "we", "it"]);
/* Words a title never ends on: "Beans from one" reads as cut off. */
const TITLE_TAIL = new Set([
  ...TITLE_STOP,
  "from",
  "one",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "and",
  "or",
  "by",
  "at",
  "is",
  "are",
  "every",
  "each",
]);

/** A card name made from the claim's first words, for a frame whose
 *  proposed title another frame already has. */
export function titleFromClaim(claim: string): string {
  const words = claim
    .replace(/[^\p{L}\p{N}₦$£€%'\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && TITLE_STOP.has(words[0].toLowerCase())) {
    words.shift();
  }
  const picked: string[] = [];
  for (const word of words.slice(0, 4)) {
    if ([...picked, word].join(" ").length > 28) break;
    picked.push(word);
  }
  while (
    picked.length > 1 &&
    TITLE_TAIL.has(picked[picked.length - 1].toLowerCase())
  ) {
    picked.pop();
  }
  const text = picked.join(" ");
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

/** Whether two card titles name one frame: the same words ignoring case,
 *  or near-duplicate wording. */
export function sameTitle(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return norm(a) === norm(b) || isNearDuplicateHeadline(a, b);
}

/** Titles with none repeated: a frame whose title an earlier frame has
 *  takes one made from its claim. */
export function distinctTitles(
  frames: readonly Pick<ArcFrame, "title" | "claim" | "role">[],
): string[] {
  const titles: string[] = [];
  frames.forEach((frame, i) => {
    const proposed = cleanTitle(frame.title);
    const taken = (t: string) =>
      titles.some((earlier) => sameTitle(earlier, t));
    const fallbacks = [
      proposed,
      titleFromClaim(frame.claim),
      frame.role === "cta" ? "How to act" : `Point ${i + 1}`,
    ];
    titles.push(
      fallbacks.find((t) => t && isCleanTitle(t) && !taken(t)) ??
        proposed ??
        frame.title,
    );
  });
  return titles;
}

/**
 * The model's assignment, held to the rules no copy is needed to check:
 *  - roles come from position;
 *  - the hook's claim is its angle, unless the angle gives a carousel's
 *    price (which belongs beside the action), when it is the hook's point
 *    in its source's words;
 *  - each body frame's point is one no earlier frame (the hook's angle and
 *    point included) already makes, by its words (claimsOverlap) or by the
 *    model's own reading of which points are one (two of one "kinds", or
 *    a "sameAs" pair); one that is
 *    missing, used twice or overlapping is replaced by the next unused point in the model's
 *    ranking, then in the pool's order;
 *  - each fact is stated once, on the frame whose point holds it; the
 *    offering on the hook, a carousel's prices and every fact no point
 *    holds on the action frame; in a carousel of three frames or more the
 *    day it happens on the hook as its news, and no time, place or contact;
 *  - titles are distinct and layouts are settled by settleFrameLayouts.
 */
export function settleArc(
  answer: Pick<ArcAnswer, "frames" | "hookAngle" | "spare"> &
    Partial<Pick<ArcAnswer, "sameAs" | "kinds">>,
  {
    pool,
    facts,
    kind,
    offeringFact,
    hasImage,
    recentLayouts = [],
    free = new Set(),
  }: SettleArcOptions,
): ArcSettlement {
  const count = answer.frames.length;
  const last = count - 1;
  const idOf = (n: number | undefined) => {
    const i = (n ?? 0) - 1;
    return Number.isInteger(i) && i >= 0 && i < pool.length ? i : null;
  };
  const prices = facts.filter((f) => f.kind === "price");
  const pricedInCarousel = (text: string) =>
    kind === "carousel" && prices.some((p) => textStatesPrice(p, text));

  const hookPoint = idOf(answer.frames[0]?.point);
  const sourceText = hookPoint === null ? "" : pool[hookPoint].text;
  const angle = answer.hookAngle.trim();
  let angleDropped: string | null = null;
  let hookClaim = angle;
  if (!angle) {
    angleDropped = "no angle was given";
    hookClaim = sourceText;
  } else if (pricedInCarousel(angle)) {
    angleDropped = "the angle gives the price, which the action frame carries";
    hookClaim = sourceText;
  }

  const kinds = answer.kinds ?? [];
  const sameKind = pool.flatMap((_, i) =>
    pool.flatMap((__, j) =>
      i !== j && kinds[i] !== undefined && kinds[i] === kinds[j]
        ? [`${i},${j}`]
        : [],
    ),
  );
  const sameAs = new Set([
    ...sameKind,
    ...(answer.sameAs ?? []).flatMap(({ a, b }) => {
      const [i, j] = [idOf(a), idOf(b)];
      return i === null || j === null || i === j
        ? []
        : [`${i},${j}`, `${j},${i}`];
    }),
  ]);
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
  /* With every distinct point spent, an unused point that shares the
     fewest words with those placed is still a point of its own to say,
     where an empty claim leaves the writer to pad. One the model itself
     reads as a point already made is never taken: that frame is left for
     the writer to find a detail no other frame gives. */
  const closest = (): number | null => {
    const unused = ranking.filter(
      (i) =>
        !used.has(i) &&
        ![...used].some((u) => sameAs.has(`${u},${i}`)) &&
        !placed.some((p) =>
          isNearDuplicateHeadline(p.text, pool[i].text, free),
        ),
    );
    if (unused.length === 0) return null;
    const shared = (i: number) => {
      const mine = contentStems(pool[i].text, free);
      return placed.reduce(
        (n, p) =>
          n + [...contentStems(p.text, free)].filter((s) => mine.has(s)).length,
        0,
      );
    };
    return unused.reduce((best, i) => (shared(i) < shared(best) ? i : best));
  };

  const replaced: ArcReplacement[] = [];
  const unsourced: number[] = [];
  const crowded: number[] = [];
  const points: (number | null)[] = answer.frames.map((frame, i) => {
    if (i === 0) return hookPoint;
    if (i === last) return null;
    const assigned = idOf(frame.point);
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
  if (kind === "carousel" && count >= 3) {
    facts.forEach((f, n) => {
      if (HOOK_NEWS.has(f.kind)) own(n, 0);
    });
  }
  points.forEach((point, frame) => {
    if (point === null) return;
    for (const n of pool[point].facts) {
      const fact = facts[n];
      if (kind === "carousel" && fact.kind === "price") continue;
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
    return point === null ? "" : pool[point].text;
  });
  const roles = answer.frames.map((_, i) => roleOf(i, count));
  const moved = new Set(replaced.map((r) => r.frame));
  const titles = distinctTitles(
    answer.frames.map((frame, i) => ({
      title: moved.has(i)
        ? titleFromClaim(claims[i]) || frame.title
        : frame.title,
      claim: claims[i],
      role: roles[i],
    })),
  );
  const factsOf = (frame: number) =>
    facts.flatMap((_, n) => (owner.get(n) === frame ? [n] : []));
  const shows = answer.frames.map(
    (frame, i) => hasImage && (i === 0 || frame.showsImage),
  );
  const layouts = settleFrameLayouts(
    answer.frames.map((frame, i) => ({
      layout: frame.layout,
      showsImage: shows[i],
      figure: factsOf(i).some((n) => hasFigure(facts[n].text)),
    })),
    recentLayouts,
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
