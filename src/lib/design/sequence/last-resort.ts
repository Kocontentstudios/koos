import { contentStems } from "@/lib/jobs/directions/text-overlap";
import { textsOverlap } from "./arc";
import { upperFirst } from "./casing";
import type { FrameBeat, PlannedSequence } from "./contract";
import {
  blockingFaults,
  breaches,
  COVERAGE,
  type CopyFault,
  type FaultRules,
  faultScore,
  setFaults,
} from "./faults";
import { asSentence, claimHalves, fitsHeadline, fitsSubheadline } from "./gate";
import { namesFree } from "./hook";

/**
 * The last step before a set ships: every frame still carrying a fault
 * that must not ship (blockingFaults) is rewritten in code from its own
 * point, the approved outline's words, which no reader can call invented
 * and no other frame was written from. Each candidate is kept only where
 * the whole set ends with fewer blocking faults, so a rewrite never moves
 * a fault from one frame to another. What still blocks after it is
 * returned for the caller to refuse the set on.
 */

export interface LastResortResult {
  plan: PlannedSequence;
  /** "frame k: how it was rewritten", in order. */
  applied: string[];
  /** Blocking faults left, breaches among them. */
  blocking: CopyFault[];
  /** Breaches left after every cut: the set must not ship with any. */
  breaches: CopyFault[];
}

/* Two passes: a frame rewritten in the first can clear a repeat that kept
   a later frame's own rewrite from helping. */
const PASSES = 2;

const blockingScore = (plan: PlannedSequence, rules: FaultRules) =>
  faultScore(blockingFaults(setFaults(plan, rules)));

/* "Each bottle is 350ml and keeps for 5 days" divides into a headline and
   "keeps for 5 days", which has no subject: the second half's subject is
   the first half's, said as "it" or "they". */
const SUBJECTLESS_VERB =
  /^(?:is|are|was|were|has|have|had|keeps?|comes?|gets?|takes?|makes?|runs?|lasts?|means?|goes?|works?|holds?|costs?|gives?)\b/i;

/* The gate splits a claim only where its head carries a verb and an
   object; as a last resort a head of two words of its own will do
   ("Each bottle is 350ml"), when its second half is given a subject. */
const LOOSE_JOIN = /,\s+|;\s+|\s+[—–]\s+|\s+and\s+/g;
const HALF_STEMS = 2;

function looseHalves(claim: string): [string, string] | null {
  const flat = claim.replace(/[.]$/, "");
  for (const join of flat.matchAll(LOOSE_JOIN)) {
    const at = join.index ?? 0;
    const head = flat.slice(0, at).trim();
    const rest = flat.slice(at + join[0].length).trim();
    if (
      contentStems(head).size >= HALF_STEMS &&
      contentStems(rest).size >= HALF_STEMS
    ) {
      return [upperFirst(head), rest];
    }
  }
  return null;
}

function withSubject(rest: string): string {
  const text = rest.trim();
  const verb = SUBJECTLESS_VERB.exec(text)?.[0];
  if (!verb) return text;
  const plural = /^(?:are|were|have)$/i.test(verb) || !/s$/i.test(verb);
  return `${plural ? "They" : "It"} ${text[0].toLowerCase()}${text.slice(1)}`;
}

/* A bare claim ("Doors open on 3 March") under its own headline only says
   it twice; the brief's sentence that holds it says more in words no
   reader can call invented. */
function briefSentencesOn(
  claim: string,
  headline: string,
  briefText: string,
  others: readonly string[],
  free: ReadonlySet<string>,
): string[] {
  const about = contentStems(`${claim} ${headline}`);
  if (about.size === 0) return [];
  return briefText
    .split(/(?<=[.!?])\s+/)
    .map((s) => asSentence(s))
    .filter(
      (s) =>
        fitsSubheadline(s) &&
        [...contentStems(s)].some((w) => about.has(w)) &&
        /* A sentence that makes another frame's point moves the repeat
           rather than clearing it. */
        !others.some((other) => textsOverlap(s, other, free)),
    );
}

interface VersionContext {
  /** Every other frame's headline and subheadline. */
  others?: readonly string[];
  /** The names any frame may say (namesFree). */
  free?: ReadonlySet<string>;
}

/** The ways a frame can say only its own point, plainest last. */
export function plainVersions(
  beat: FrameBeat,
  claim: string,
  kind: PlannedSequence["kind"],
  briefText = "",
  { others = [], free = new Set<string>() }: VersionContext = {},
): { change: Partial<FrameBeat>; what: string }[] {
  const point = claim.trim().replace(/\s+/g, " ");
  const versions: { change: Partial<FrameBeat>; what: string }[] = [];
  const sentence = point ? asSentence(point) : "";
  const halves = point ? (claimHalves(point) ?? looseHalves(point)) : null;
  if (halves) {
    const [headline, rest] = halves;
    const subheadline = [asSentence(rest), asSentence(withSubject(rest))].find(
      fitsSubheadline,
    );
    if (fitsHeadline(headline, kind) && subheadline) {
      versions.push({
        change: { headline, subheadline },
        what: "its point as headline and subheadline",
      });
    }
    /* A hook's point often opens on its name ("Ata Kitchen's sauce, made
       in small batches in Ibadan"): the reason leads and the name goes
       under it. */
    const reason = upperFirst(rest.replace(/[.]$/, ""));
    const named = asSentence(headline);
    if (
      beat.role === "hook" &&
      fitsHeadline(reason, kind) &&
      fitsSubheadline(named)
    ) {
      versions.push({
        change: { headline: reason, subheadline: named },
        what: "its point's reason over its name",
      });
    }
  }
  if (sentence && fitsSubheadline(sentence)) {
    versions.push({
      change: { subheadline: sentence },
      what: "its point under its headline",
    });
    const title = beat.title.trim();
    if (title && fitsHeadline(title, kind)) {
      versions.push({
        change: { headline: title, subheadline: sentence },
        what: "its title over its point",
      });
    }
  }
  const asHeadline = point.replace(/[.]$/, "");
  if (asHeadline && fitsHeadline(asHeadline, kind)) {
    versions.push({
      change: { headline: asHeadline },
      what: "its point as the headline",
    });
  }
  for (const line of briefSentencesOn(
    point,
    beat.headline,
    briefText,
    others,
    free,
  )) {
    versions.push({
      change: { subheadline: line },
      what: "the brief's own sentence on its point under its headline",
    });
    if (asHeadline && fitsHeadline(asHeadline, kind) && line !== sentence) {
      versions.push({
        change: { headline: asHeadline, subheadline: line },
        what: "its point over the brief's own sentence on it",
      });
    }
  }
  if (beat.role !== "body" && beat.subheadline.trim()) {
    versions.push({
      change: { subheadline: "" },
      what: "its subheadline cut",
    });
  }
  return versions;
}

const SENTENCE = /(?<=[.!?])\s+(?=\S)/;
const FOOTER_ITEM = /\s+·\s+/;

/** Each version of a frame with one line a reader sees taken away: a
 *  footer item, or one sentence of the subheadline. */
export function lineCuts(beat: FrameBeat): Partial<FrameBeat>[] {
  const cuts: Partial<FrameBeat>[] = [];
  beat.footerLines.forEach((line, n) => {
    const items = line.split(FOOTER_ITEM);
    items.forEach((_, k) => {
      const kept = items.filter((__, j) => j !== k).join(" · ");
      const footerLines = beat.footerLines.flatMap((l, j) =>
        j === n ? (kept ? [kept] : []) : [l],
      );
      cuts.push({ footerLines });
    });
  });
  const sentences = beat.subheadline.split(SENTENCE).filter(Boolean);
  sentences.forEach((_, k) => {
    cuts.push({
      subheadline: sentences.filter((__, j) => j !== k).join(" "),
    });
  });
  return cuts;
}

const coverageLost = (faults: readonly CopyFault[]) =>
  faults.filter((f) => f.weight >= COVERAGE).length;

/**
 * The set with the lines that breach it cut (CopyFault.breach): a removed
 * point said in small print, a claim no source gives, a fact the owner
 * took out. Saying less is always allowed; saying what the owner took out
 * never is. A cut is kept only where the set ends with fewer breaches and
 * no brief fact or offering newly left off.
 */
export function withBreachesCut(
  plan: PlannedSequence,
  rules: FaultRules,
  tidy: (frames: readonly FrameBeat[]) => FrameBeat[] = (frames) => [...frames],
): { plan: PlannedSequence; applied: string[] } {
  let current = plan;
  let faults = setFaults(current, rules);
  const applied: string[] = [];
  let improved = true;
  while (improved && breaches(faults).length > 0) {
    improved = false;
    const frames = [...new Set(breaches(faults).map((f) => f.frame))];
    for (const frame of frames) {
      const beat = current.frames[frame];
      if (!beat) continue;
      for (const change of lineCuts(beat)) {
        const next: PlannedSequence = {
          ...current,
          frames: tidy(
            current.frames.map((b, i) =>
              i === frame ? { ...b, ...change } : b,
            ),
          ),
        };
        const nextFaults = setFaults(next, rules);
        if (
          breaches(nextFaults).length < breaches(faults).length &&
          coverageLost(nextFaults) <= coverageLost(faults)
        ) {
          current = next;
          faults = nextFaults;
          applied.push(`frame ${frame + 1}: a line that breached cut`);
          improved = true;
          break;
        }
      }
    }
  }
  return { plan: current, applied };
}

/* A fault on one frame often names the frame it collides with ("the
   hook already says what frame 3 is for"): the collision clears from
   either end, so the other frame's own plain versions are tried too. */
const NAMED_FRAME = /\bframe (\d+)\b/g;

/** The frames whose rewrite could clear `fault`, the one most worth
 *  rewriting first: a later frame before the hook, since the hook is what
 *  earned the swipe; otherwise the faulted frame before the one it
 *  names. */
export function framesToTry(fault: CopyFault, count: number): number[] {
  const named = [...fault.detail.matchAll(NAMED_FRAME)]
    .map((m) => Number(m[1]) - 1)
    .filter((i) => i >= 0 && i < count && i !== fault.frame);
  const partners = [...new Set(named)];
  return fault.frame === 0
    ? [...partners, fault.frame]
    : [fault.frame, ...partners];
}

const faultKey = (f: CopyFault) => `${f.frame}|${f.detail}`;

/** Copy another writer gave a frame: the second draft's version of it,
 *  or an opening the writers offered beside their own hook. */
export type AlternateCopy = Partial<
  Pick<FrameBeat, "headline" | "subheadline" | "footerLines" | "cta">
>;

/** `tidy` settles what follows from a frame's copy (its title, the set's
 *  casing) after a rewrite, as the planner does after every rewrite.
 *  `alternates` holds, by frame, copy the writers already gave it for its
 *  own claim: tried beside code's plain versions, at no extra call. */
export function lastResort(
  plan: PlannedSequence,
  rules: FaultRules,
  claims: readonly string[],
  tidy: (frames: readonly FrameBeat[]) => FrameBeat[] = (frames) => [...frames],
  alternates: readonly (readonly AlternateCopy[])[] = [],
): LastResortResult {
  let current = plan;
  let score = blockingScore(current, rules);
  const applied: string[] = [];
  /* The brief first, then the profile and the owner's own words: a
     sentence any of them gives on a frame's point is no invention. */
  const sourceText = [
    rules.briefText ?? "",
    ...(rules.titleSources ?? []).filter((t) => t !== rules.briefText),
  ]
    .map((t) => asSentence(t.trim()))
    .filter((t) => t.length > 1)
    .join(" ");
  const versionsOf = (frame: number) => {
    const beat = current.frames[frame];
    if (!beat) return [];
    return [
      ...(alternates[frame] ?? []).map((change) => ({
        change,
        what: "another writer's version of it",
      })),
      ...plainVersions(beat, claims[frame] ?? "", current.kind, sourceText, {
        others: current.frames
          .filter((_, i) => i !== frame)
          .map((b) => `${b.headline} ${b.subheadline}`),
        free: namesFree(rules.brandName, rules.offering),
      }),
      ...lineCuts(beat).map((change) => ({
        change,
        what: "a line that said another frame's point cut",
      })),
    ];
  };
  const bestOf = (frame: number) => {
    let best: { plan: PlannedSequence; score: number; what: string } | null =
      null;
    for (const { change, what } of versionsOf(frame)) {
      const next: PlannedSequence = {
        ...current,
        frames: tidy(
          current.frames.map((b, i) => (i === frame ? { ...b, ...change } : b)),
        ),
      };
      const nextScore = blockingScore(next, rules);
      if (nextScore < (best?.score ?? score)) {
        best = { plan: next, score: nextScore, what };
      }
    }
    return best;
  };
  for (let pass = 0; pass < PASSES && score > 0; pass += 1) {
    const faults = blockingFaults(setFaults(current, rules));
    for (const fault of faults) {
      const standing = new Set(
        blockingFaults(setFaults(current, rules)).map(faultKey),
      );
      if (!standing.has(faultKey(fault))) continue;
      for (const frame of framesToTry(fault, current.frames.length)) {
        const best = bestOf(frame);
        if (!best) continue;
        current = best.plan;
        score = best.score;
        applied.push(`frame ${frame + 1}: ${best.what}`);
        break;
      }
    }
  }
  const cut = withBreachesCut(current, rules, tidy);
  const left = setFaults(cut.plan, rules);
  return {
    plan: cut.plan,
    applied: [...applied, ...cut.applied],
    blocking: blockingFaults(left),
    breaches: breaches(left),
  };
}
