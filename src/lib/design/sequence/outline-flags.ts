import type { BriefFact, CoverKind } from "@/lib/jobs/directions/brief-facts";
import { contentStems } from "@/lib/jobs/directions/text-overlap";
import { claimsOverlap } from "./arc";
import type { OutlinePoint, OutlineWeak, SequenceKind } from "./contract";
import { EMPTY_POINT, factsIn } from "./outline-arc";

export interface OutlineFlagContext {
  kind: SequenceKind;
  /** The brief's facts the outline was planned against (sequenceFacts). */
  facts: readonly BriefFact[];
  /** Words every point may share: the brand's and the offering's names
   *  (namesFree). */
  free: ReadonlySet<string>;
  /** Who the brand profile says it is for (targetAudience): a point that
   *  only says this tells the reader who they are, not what they get. */
  audience?: string | null;
  /** The profile's statements of what the brand is, sells and believes
   *  (overview, offer, values; genericProfile). A point drawn from one
   *  describes the brand, which the hook already names, and its flag
   *  says to replace it. */
  genericProfile?: readonly string[];
}

/** The profile fields whose statements describe the brand rather than
 *  give the reader a fact about the offer. */
export const GENERIC_PROFILE_FIELDS = ["overview", "offer", "values"] as const;

export function genericProfile(
  brand: Partial<
    Record<(typeof GENERIC_PROFILE_FIELDS)[number], string | null>
  >,
): string[] {
  return GENERIC_PROFILE_FIELDS.flatMap((field) => {
    const text = brand[field]?.trim();
    return text ? [text] : [];
  });
}

/* Share of a point's content words a profile statement must hold for the
   point to be that statement: the pool cuts a field into clauses and the
   planner keeps their words. */
const DRAWN_SHARE = 0.8;

function drawnFrom(point: string, statements: readonly string[]): boolean {
  const own = [...contentStems(point)];
  if (own.length === 0) return false;
  return statements.some((statement) => {
    const theirs = contentStems(statement);
    return own.filter((s) => theirs.has(s)).length / own.length >= DRAWN_SHARE;
  });
}

/** A point as flagOutline reads it: its words, role and source. */
type Draft = Omit<OutlinePoint, "weak" | "sig">;

const isEmpty = (point: Pick<Draft, "point">) =>
  point.point.trim() === EMPTY_POINT;

const WHEN = new Set<CoverKind>(["date", "day", "time"]);

/* A figure the reader weighs ("Only 12 places", "Ready in 3 days") is a
   point a slide can carry on its own: scarcity and turnaround read as a
   reason, not as a label. */
const CONCRETE = new Set<CoverKind>(["quantity", "offer", "condition", "age"]);
const WHERE = new Set<CoverKind>(["place", "contact"]);

/* Words that only frame who or where ("Built for", "Located in"): a point
   made of these and a fact says nothing of its own. */
const FRAMING = contentStems(
  "built made designed perfect ideal aimed meant located based find here open welcome everyone anyone",
);

/* A body point needs this many words of its own, beyond names, framing,
   its logistics and who it is for, to carry a slide: "Steeped for 18
   hours" has two, "12 places" one. */
const OWN_WORDS = 2;

const isWord = (stem: string) => !/^\d+$/.test(stem);

/* "Six Saturdays", "₦150 per kWh", "Ngozi Ade": a point this short is a
   fact or a name with nothing said about it, which the copy can only
   print as a bare headline. */
const BARE_WORDS = 3;
const wordsIn = (text: string) =>
  text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

function fillerReason(
  point: Draft,
  stated: readonly BriefFact[],
  ctx: OutlineFlagContext,
): string | null {
  const audience = contentStems(ctx.audience ?? "");
  const logistics = stated.filter((f) => WHEN.has(f.kind) || WHERE.has(f.kind));
  const ignored = new Set([
    ...ctx.free,
    ...FRAMING,
    ...audience,
    ...logistics.flatMap((f) => [...contentStems(f.text)]),
  ]);
  const own = [...contentStems(point.point, ignored)].filter(isWord);
  if (own.length >= OWN_WORDS && wordsIn(point.point) > BARE_WORDS) {
    return null;
  }
  if (logistics.some((f) => WHEN.has(f.kind))) {
    return "Only says when it happens. Add what the reader gets.";
  }
  if (logistics.length > 0) {
    return "Only says where to find it. Add what the reader gets there.";
  }
  if (stated.some((f) => CONCRETE.has(f.kind) && /\p{N}/u.test(f.text))) {
    return null;
  }
  const said = contentStems(point.point, ctx.free);
  if ([...said].some((s) => audience.has(s))) {
    return "Only says who it is for. Say what they get from it.";
  }
  const fact = stated[0];
  if (fact) {
    return `Only gives "${fact.text}". Say what it means for the reader.`;
  }
  if (own.length >= OWN_WORDS) {
    return `Only gives "${point.point}". Say what it means for the reader.`;
  }
  return "Too thin to fill a slide. Say one thing the reader gets or should know.";
}

/* Words that announce rather than give a reason ("Now open", "Introducing"). */
const ANNOUNCING = contentStems(
  "launch launching new introducing back now available here arrived arrives brings offers rents sells",
);

/* A hook needs this many words of its own, or a figure, to be a reason to
   swipe rather than a label: "Farmlink rents solar cold rooms in Kano"
   names the offer and where, and nothing a reader leans in for. */
const HOOK_OWN_WORDS = 3;

function labelHook(
  point: Draft,
  stated: readonly BriefFact[],
  ctx: OutlineFlagContext,
): boolean {
  if (/\p{N}/u.test(point.point)) return false;
  const ignored = new Set([
    ...ctx.free,
    ...FRAMING,
    ...ANNOUNCING,
    ...stated.flatMap((f) => [...contentStems(f.text)]),
  ]);
  return contentStems(point.point, ignored).size < HOOK_OWN_WORDS;
}

/**
 * The points with `weak` set by code, never by a model. Pure and
 * deterministic; one flag per point, first match wins:
 *  - overlap: the point makes an earlier point's point (claimsOverlap);
 *    overlapsWith names the earlier id;
 *  - filler: a body point whose only content is who it is for, when or
 *    where (audience, date, day, time, place), or one bare fact, unless
 *    that fact is a figure the reader weighs (CONCRETE);
 *  - filler also: a point of three words or fewer ("Six Saturdays"), a
 *    fact or a name with nothing said about it, and the prompt left on a
 *    frame nothing was found for (EMPTY_POINT), which is checked first
 *    and is never the earlier point another overlaps;
 *  - profile-fill: a body point drawn from the profile because the brief
 *    ran out (Addendum A, O2) that states what the brand is, sells or
 *    believes (genericProfile): it repeats the hook. A profile point of
 *    what sets the brand apart ("Beans from the Mambilla Plateau") is a
 *    fact the slide can carry; it shows its source and is not flagged, so
 *    a flag still means something on a thin brief. Never set on a "user"
 *    point.
 * The hook opens the set, so it repeats nothing and is never filler for
 * giving when or where; it is flagged only as a label (labelHook): no
 * figure and fewer than three words of its own beyond the names. The
 * action is never flagged: its point is how to act, which a date or place
 * is, and swapping it for another point would leave the set with no
 * action.
 */
export function flagOutline<P extends Draft>(
  points: readonly P[],
  ctx: OutlineFlagContext,
): (P & { weak: OutlineWeak | null })[] {
  const claims = points.map((p) => ({
    text: p.point,
    facts: factsIn(p.point, ctx.facts),
  }));
  return points.map((point, i) => {
    const weak = (w: OutlineWeak | null): P & { weak: OutlineWeak | null } => ({
      ...point,
      weak: w,
    });
    if (point.role === "hook") {
      const stated = claims[i].facts.map((n) => ctx.facts[n]);
      return labelHook(point, stated, ctx)
        ? weak({
            kind: "filler",
            reason:
              "Names the offer but gives no reason to swipe. Lead with a figure or what the reader gets.",
          })
        : weak(null);
    }
    if (point.role !== "body") return weak(null);
    if (isEmpty(point)) {
      return weak({
        kind: "filler",
        reason:
          "Nothing in the brief or profile was left for this slide. Write its point, or delete it.",
      });
    }
    const earlier = claims
      .slice(0, i)
      .findIndex(
        (c, k) =>
          !isEmpty(points[k]) &&
          claimsOverlap(c, claims[i], ctx.facts, ctx.free),
      );
    if (earlier >= 0) {
      return weak({
        kind: "overlap",
        reason: `Says the same as point ${earlier + 1}. Give this slide a different point.`,
        overlapsWith: points[earlier].id,
      });
    }
    const stated = claims[i].facts.map((n) => ctx.facts[n]);
    const filler = fillerReason(point, stated, ctx);
    if (filler) return weak({ kind: "filler", reason: filler });
    if (
      point.source !== "profile" ||
      !drawnFrom(point.point, ctx.genericProfile ?? [])
    ) {
      return weak(null);
    }
    return weak({
      kind: "profile-fill",
      reason:
        "Taken from your brand profile because the brief ran out: it says what the brand is or believes, which the first slide already says. Replace it with a fact about this offer.",
    });
  });
}
