import type { BriefFact, CoverKind } from "@/lib/jobs/directions/brief-facts";
import { contentStems } from "@/lib/jobs/directions/text-overlap";
import { claimsOverlap } from "./arc";
import type { OutlinePoint, OutlineWeak, SequenceKind } from "./contract";
import { factsIn } from "./outline-arc";

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
}

const WHEN = new Set<CoverKind>(["date", "day", "time"]);
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

function fillerReason(
  point: Omit<OutlinePoint, "weak">,
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
  if (own.length >= OWN_WORDS) return null;
  if (logistics.some((f) => WHEN.has(f.kind))) {
    return "Only says when it happens. Add what the reader gets.";
  }
  if (logistics.length > 0) {
    return "Only says where to find it. Add what the reader gets there.";
  }
  const said = contentStems(point.point, ctx.free);
  if ([...said].some((s) => audience.has(s))) {
    return "Only says who it is for. Say what they get from it.";
  }
  const fact = stated[0];
  if (fact) {
    return `Only gives "${fact.text}". Say what it means for the reader.`;
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
  point: Omit<OutlinePoint, "weak">,
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
 *    where (audience, date, day, time, place), or one bare fact;
 *  - profile-fill: a body point drawn from the brand profile because the
 *    brief ran out. Never set on a "user" point.
 * The hook opens the set, so it repeats nothing and is never filler for
 * giving when or where; it is flagged only as a label (labelHook): no
 * figure and fewer than three words of its own beyond the names. The
 * action is never flagged: its point is how to act, which a date or place
 * is, and swapping it for another point would leave the set with no
 * action.
 */
export function flagOutline(
  points: readonly Omit<OutlinePoint, "weak">[],
  ctx: OutlineFlagContext,
): OutlinePoint[] {
  const claims = points.map((p) => ({
    text: p.point,
    facts: factsIn(p.point, ctx.facts),
  }));
  return points.map((point, i) => {
    const weak = (w: OutlineWeak | null): OutlinePoint => ({
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
    const earlier = claims
      .slice(0, i)
      .findIndex((c) => claimsOverlap(c, claims[i], ctx.facts, ctx.free));
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
    if (point.source === "profile") {
      return weak({
        kind: "profile-fill",
        reason:
          "Taken from your brand profile, not this brief. Replace it with something about this offer.",
      });
    }
    return weak(null);
  });
}
